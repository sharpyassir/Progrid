import { AGENT_S3_PY, agentNetPy, indentBlock } from '../../common/platform-agent';

/** Flannel release the clusters install; bump deliberately after testing. */
export const FLANNEL_MANIFEST = 'https://github.com/flannel-io/flannel/releases/download/v0.26.1/kube-flannel.yml';

/**
 * cloud-init for a managed Kubernetes node (control plane or worker; the role comes with
 * the first config push). Installs containerd, kubeadm, kubelet and kubectl from the
 * upstream package repository for the cluster's minor version, plus `pgcloud-k8sd`: an HTTP
 * agent on :9009 that receives the node's configuration from the control plane
 * (POST /config) and reports state (GET /status).
 *
 * What the agent does with a config:
 *   control plane, index 0   kubeadm init behind the VIP, install the CNI (flannel, pinned
 *                            and bound to the private interface), the pgcloud-block
 *                            StorageClass, issue join tokens (24 hour TTL, POST /join-token
 *                            for later joins), upload certificates for the other control
 *                            plane nodes, label and taint
 *                            nodes, patch LoadBalancer Services with the addresses the
 *                            platform assigned, create PersistentVolumes for block volumes
 *                            the platform attached, and remove nodes that left the cluster
 *   control plane, others    kubeadm join --control-plane
 *   workers                  kubeadm join, then format and mount block volumes assigned to
 *                            them under /var/lib/pgcloud/volumes/<id>
 *
 * Every node's kubelet uses the private address (--node-ip). Control plane nodes renew the
 * kubeadm certificates monthly, one node a day apart, and take a daily etcd snapshot that
 * goes to the cluster's bucket when it has one, or stays on the node for seven days.
 *
 * GET /status on node 0 also carries the admin kubeconfig, the CA hash the joiners need,
 * node readiness, LoadBalancer Services and pending PersistentVolumeClaims of the
 * pgcloud-block class. The control plane turns those into load balancers and volumes and
 * feeds the results back in the next config.
 */
export interface KubeNodeInit {
  version: string; // "1.31"
  vmSecret: string;
  /**
   * Network the API VIP lives on: private for a private address, public for the public
   * address in kubeconfig today (see vipNetworkFor). VRRP always runs over the private network.
   */
  vipNetwork: 'public' | 'private';
}

export function renderKubeCloudInit(d: KubeNodeInit): string {
  return `#cloud-config
package_update: true
packages: [containerd, keepalived, python3, apt-transport-https, ca-certificates, curl, gpg, nfs-common, open-iscsi]
write_files:
  - path: /etc/modules-load.d/k8s.conf
    content: |
      overlay
      br_netfilter
  - path: /etc/sysctl.d/90-pgcloud-k8s.conf
    content: |
      net.bridge.bridge-nf-call-iptables = 1
      net.bridge.bridge-nf-call-ip6tables = 1
      net.ipv4.ip_forward = 1
      net.ipv4.ip_nonlocal_bind = 1
  - path: /opt/pgcloud/vm.secret
    permissions: '0600'
    content: '${d.vmSecret}'
  - path: /opt/pgcloud/kube.version
    content: '${d.version}'
  - path: /opt/pgcloud/vip.network
    content: '${d.vipNetwork}'
  - path: /etc/systemd/system/pgcloud-k8sd.service
    content: |
      [Unit]
      Description=pgcloud kubernetes node agent
      After=network-online.target
      [Service]
      ExecStart=/usr/bin/python3 /opt/pgcloud/k8sd.py
      Restart=always
      RestartSec=2
      [Install]
      WantedBy=multi-user.target
  - path: /opt/pgcloud/k8sd.py
    permissions: '0755'
    content: |
      #!/usr/bin/env python3
      # pgcloud managed Kubernetes node agent. Standard library only.
      import base64, glob, http.server, json, os, re, shutil, subprocess, threading, time, urllib.request, urllib.parse
      SECRET = open('/opt/pgcloud/vm.secret').read().strip()
      STATE = '/opt/pgcloud/state.json'
      LAST = '/opt/pgcloud/last-config.json'
      lock = threading.Lock()
      slock = threading.Lock()
      FLANNEL = '${FLANNEL_MANIFEST}'
      CRICTL = 'crictl --runtime-endpoint unix:///run/containerd/containerd.sock '
      SNAPSHOTS = '/var/lib/pgcloud/etcd-snapshots'

      def sh(cmd, check=True, timeout=900, env=None):
          r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout, env=env)
          if check and r.returncode != 0: raise RuntimeError(f'{cmd[:80]}: {r.stderr.strip()[-400:] or r.stdout.strip()[-400:]}')
          return r.stdout
      def write(path, content, mode=0o644):
          os.makedirs(os.path.dirname(path), exist_ok=True); open(path, 'w').write(content); os.chmod(path, mode)
${agentNetPy(6)}

      def state():
          try: return json.load(open(STATE))
          except Exception: return {'version': 0}
      def save(st): json.dump(st, open(STATE, 'w'))
      def update_state(**kw):
          with slock:
              st = state(); st.update(kw); save(st)
      def log(msg):
          try: open('/var/log/pgcloud-k8sd.log', 'a').write(time.strftime('%Y-%m-%dT%H:%M:%SZ ', time.gmtime()) + msg + '\\n')
          except Exception: pass
      def last_config():
          try: return json.load(open(LAST))
          except Exception: return None
      def size_gb(q, default=10):
          # Kubernetes quantity (10Gi, 500Mi, 1Ti, 20G, plain bytes) in whole GiB, rounded up. Odd values fall back to the default.
          try:
              q = str(q).strip()
              units = {'Ki': 2**10, 'Mi': 2**20, 'Gi': 2**30, 'Ti': 2**40, 'Pi': 2**50, 'k': 10**3, 'K': 10**3, 'M': 10**6, 'G': 10**9, 'T': 10**12, 'P': 10**15}
              n = None
              for u in sorted(units, key=len, reverse=True):
                  if q.endswith(u): n = float(q[:-len(u)]) * units[u]; break
              if n is None: n = float(q)
              return max(1, -(-int(n) // 2**30))
          except Exception: return default
      def node_ip(m):
          return private_ipv4() or m['ip']
      def kubelet_node_ip(m):
          # The kubelet registers and serves on the private address, not the public one.
          if write_if_changed('/etc/default/kubelet', 'KUBELET_EXTRA_ARGS=--node-ip=%s\\n' % node_ip(m)):
              sh('systemctl restart kubelet', check=False)
      def write_if_changed(path, content, mode=0o644):
          old = open(path).read() if os.path.exists(path) else None
          if old == content: return False
          write(path, content, mode); return True
      def kubectl(args, check=True, inp=None):
          r = subprocess.run('kubectl --kubeconfig /etc/kubernetes/admin.conf ' + args, shell=True, capture_output=True, text=True, timeout=120, input=inp)
          if check and r.returncode != 0: raise RuntimeError('kubectl ' + args[:60] + ': ' + r.stderr.strip()[-300:])
          return r.stdout
      def me(c): return [n for n in c['cluster']['nodes'] if n['isSelf']][0]
      def initialized(): return os.path.exists('/etc/kubernetes/kubelet.conf')

      def keepalived(c, m):
          # VRRP runs unicast between the control plane nodes over the private network; the VIP
          # sits on the interface named by /opt/pgcloud/vip.network.
          peers = [n['ip'] for n in c['cluster']['nodes'] if n['role'] == 'control' and not n['isSelf']]
          uni = ("  unicast_src_ip %s\\n  unicast_peer { %s }\\n" % (private_ipv4() or m['ip'], ' '.join(peers))) if peers else ''
          text = "vrrp_script chk_api {\\n  script \\"/usr/bin/curl -sfk https://127.0.0.1:6443/healthz\\"\\n  interval 2\\n  fall 3\\n  rise 2\\n}\\nvrrp_instance VI_k8s {\\n  state BACKUP\\n  interface %s\\n  virtual_router_id %d\\n  priority %d\\n  advert_int 1\\n%s  authentication { auth_type PASS auth_pass %s }\\n  virtual_ipaddress { %s/%d dev %s }\\n  track_script { chk_api }\\n}\\n" % (private_iface() or 'eth0', c['cluster']['vrid'], 100 - m['index'], uni, c['cluster']['vrrpPass'], c['cluster']['vip'], c['cluster']['prefix'], vip_iface())
          if os.path.exists('/etc/keepalived/keepalived.conf') and open('/etc/keepalived/keepalived.conf').read() == text: return
          write('/etc/keepalived/keepalived.conf', text)
          sh('systemctl enable --now keepalived && systemctl restart keepalived', check=False)

      def init_control(c, m):
          cfg = {'apiVersion': 'kubeadm.k8s.io/v1beta4', 'kind': 'ClusterConfiguration', 'kubernetesVersion': 'stable-' + c['kubeVersion'],
                 'clusterName': c['cluster']['name'], 'controlPlaneEndpoint': c['cluster']['endpoint'],
                 'networking': {'podSubnet': c['podCidr'], 'serviceSubnet': c['serviceCidr']},
                 'apiServer': {'certSANs': [c['cluster']['vip'], node_ip(m), m['ip'], m['name']]}}
          # Join tokens live 24 hours; nodes added later get a fresh one through POST /join-token.
          init = {'apiVersion': 'kubeadm.k8s.io/v1beta4', 'kind': 'InitConfiguration', 'certificateKey': c['certKey'],
                  'bootstrapTokens': [{'token': c['joinToken'], 'ttl': '24h'}],
                  'localAPIEndpoint': {'advertiseAddress': node_ip(m)}, 'nodeRegistration': {'name': m['name']}}
          write('/opt/pgcloud/kubeadm.json', json.dumps(cfg) + '\\n---\\n' + json.dumps(init), 0o600)
          sh('kubeadm init --config /opt/pgcloud/kubeadm.json --upload-certs', timeout=1200)
          # Flannel from a pinned release, with the cluster's pod network and VXLAN on the private interface.
          manifest = sh('curl -fsSL %s' % FLANNEL, timeout=120).replace('10.244.0.0/16', c['podCidr'])
          iface = private_iface() or 'eth0'
          manifest = re.sub(r'\\n(\\s*)- --kube-subnet-mgr', lambda x: x.group(0) + '\\n' + x.group(1) + '- --iface=' + iface, manifest, count=1)
          kubectl('apply -f -', inp=manifest)
          kubectl('apply -f -', inp=json.dumps({'apiVersion': 'storage.k8s.io/v1', 'kind': 'StorageClass', 'metadata': {'name': 'pgcloud-block', 'annotations': {'storageclass.kubernetes.io/is-default-class': 'true'}}, 'provisioner': 'pgcloud.dev/block', 'volumeBindingMode': 'WaitForFirstConsumer', 'reclaimPolicy': 'Delete'}))

      def join(c, m, control):
          extra = ' --control-plane --certificate-key ' + c['certKey'] + ' --apiserver-advertise-address ' + node_ip(m) if control else ''
          sh('kubeadm join %s --token %s --discovery-token-ca-cert-hash sha256:%s --node-name %s%s' % (c['cluster']['endpoint'], c['joinToken'], c['caHash'], m['name'], extra), timeout=1200)

      def reconcile_control(c):
          # The certificate key must stay usable for control plane nodes that join later (tokens: POST /join-token).
          sh('kubeadm init phase upload-certs --upload-certs --certificate-key %s' % c['certKey'], check=False)
          for n in c['cluster']['nodes']:
              if n['role'] != 'worker': continue
              labels = ' '.join('%s=%s' % (k, v) for k, v in (n.get('labels') or {}).items())
              if labels: kubectl('label node %s %s --overwrite' % (n['name'], labels), check=False)
              for t in n.get('taints') or []:
                  kubectl('taint node %s %s=%s:%s --overwrite' % (n['name'], t['key'], t.get('value', ''), t.get('effect', 'NoSchedule')), check=False)
          # Services of type LoadBalancer get the address the platform assigned.
          for key, svc in (c.get('services') or {}).items():
              ns, name = key.split('/', 1)
              if svc.get('ip'):
                  kubectl('-n %s patch svc %s --subresource=status -p %s' % (ns, name, json.dumps(json.dumps({'status': {'loadBalancer': {'ingress': [{'ip': svc['ip']}]}}}))), check=False)
          # PersistentVolumes for block volumes that a worker has mounted.
          for pv in c.get('pvs') or []:
              spec = {'apiVersion': 'v1', 'kind': 'PersistentVolume', 'metadata': {'name': pv['name'], 'labels': {'pgcloud.dev/volume': pv['volumeId']}},
                      'spec': {'capacity': {'storage': '%dGi' % pv['sizeGb']}, 'accessModes': ['ReadWriteOnce'], 'persistentVolumeReclaimPolicy': 'Retain', 'storageClassName': 'pgcloud-block', 'volumeMode': 'Filesystem',
                               'local': {'path': pv['path']}, 'claimRef': {'namespace': pv['pvcNamespace'], 'name': pv['pvcName']},
                               'nodeAffinity': {'required': {'nodeSelectorTerms': [{'matchExpressions': [{'key': 'kubernetes.io/hostname', 'operator': 'In', 'values': [pv['node']]}]}]}}}}
              kubectl('apply -f -', inp=json.dumps(spec), check=False)
          for name in c.get('deletePvs') or []:
              kubectl('delete pv %s --ignore-not-found --wait=false' % name, check=False)
          for name in c.get('removeNodes') or []:
              kubectl('drain %s --ignore-daemonsets --delete-emptydir-data --force --timeout=120s' % name, check=False)
              kubectl('delete node %s --ignore-not-found' % name, check=False)

      def mount_volumes(c):
          mounted = []
          for v in c.get('volumes') or []:
              devs = glob.glob('/dev/disk/by-id/*%s*' % v['serial'])
              devs = [d for d in devs if '-part' not in d]
              if not devs: continue
              dev = devs[0]; path = '/var/lib/pgcloud/volumes/' + v['id']
              if 'ext4' not in sh('blkid -o value -s TYPE %s' % dev, check=False): sh('mkfs.ext4 -F -q %s' % dev)
              os.makedirs(path, exist_ok=True)
              if path not in sh('mount', check=False): sh('mount %s %s' % (dev, path))
              fstab = open('/etc/fstab').read()
              if path not in fstab: open('/etc/fstab', 'a').write('%s %s ext4 defaults,nofail 0 2\\n' % (dev, path))
              mounted.append(v['id'])
          # Volumes that left the config are unmounted so they can be detached.
          for path in glob.glob('/var/lib/pgcloud/volumes/*'):
              vid = os.path.basename(path)
              if vid not in [v['id'] for v in c.get('volumes') or []]:
                  sh('umount %s' % path, check=False); os.rmdir(path) if os.path.isdir(path) and not os.listdir(path) else None
                  lines = [l for l in open('/etc/fstab') if path not in l]; open('/etc/fstab', 'w').writelines(lines)
          return mounted

      def apply(c):
          m = me(c)
          if not initialized(): kubelet_node_ip(m)
          if m['role'] == 'control':
              keepalived(c, m)
              if not initialized():
                  if m['index'] == 0: init_control(c, m)
                  elif c.get('caHash'): join(c, m, True)
                  else: raise NotReady('waiting for the first control plane node')
              if m['index'] == 0: reconcile_control(c)
          else:
              if not initialized():
                  if not c.get('caHash'): raise NotReady('waiting for the control plane')
                  join(c, m, False)
              update_state(mounted=mount_volumes(c))

      class NotReady(Exception): pass

      def status():
          st = state(); c = None
          try: c = json.load(open(LAST))
          except Exception: pass
          out = {'version': st.get('version', 0), 'initialized': initialized(), 'mounted': st.get('mounted', []), 'role': me(c)['role'] if c else None, 'index': me(c)['index'] if c else None,
                 'etcdSnapshot': st.get('etcdSnapshot'), 'etcdSnapshotError': st.get('etcdSnapshotError'), 'certsRenewedAt': st.get('certsRenewedAt'), 'certsError': st.get('certsError')}
          if c and me(c)['role'] == 'control' and me(c)['index'] == 0 and os.path.exists('/etc/kubernetes/admin.conf'):
              try:
                  out['caHash'] = sh("openssl x509 -pubkey -in /etc/kubernetes/pki/ca.crt | openssl rsa -pubin -outform der 2>/dev/null | openssl dgst -sha256 -hex | sed 's/^.* //'", check=False).strip()
                  out['kubeconfig'] = base64.b64encode(open('/etc/kubernetes/admin.conf', 'rb').read()).decode()
                  nodes = json.loads(kubectl('get nodes -o json', check=False) or '{"items":[]}')
                  out['nodes'] = [{'name': n['metadata']['name'], 'ready': any(x['type'] == 'Ready' and x['status'] == 'True' for x in n['status'].get('conditions', [])), 'version': n['status'].get('nodeInfo', {}).get('kubeletVersion')} for n in nodes.get('items', [])]
                  svcs = json.loads(kubectl('get svc -A -o json', check=False) or '{"items":[]}')
                  out['services'] = [{'namespace': s['metadata']['namespace'], 'name': s['metadata']['name'], 'uid': s['metadata']['uid'],
                                      'ports': [{'port': p['port'], 'nodePort': p.get('nodePort'), 'protocol': p.get('protocol', 'TCP')} for p in s['spec'].get('ports', []) if p.get('nodePort')],
                                      'ip': (s['status'].get('loadBalancer', {}).get('ingress') or [{}])[0].get('ip')}
                                     for s in svcs.get('items', []) if s['spec'].get('type') == 'LoadBalancer']
                  pvcs = json.loads(kubectl('get pvc -A -o json', check=False) or '{"items":[]}')
                  out['pvcs'] = [{'namespace': p['metadata']['namespace'], 'name': p['metadata']['name'], 'uid': p['metadata']['uid'], 'phase': (p.get('status') or {}).get('phase'),
                                  'sizeGb': size_gb(((p['spec'].get('resources') or {}).get('requests') or {}).get('storage', '10Gi')),
                                  'node': (p['metadata'].get('annotations') or {}).get('volume.kubernetes.io/selected-node')}
                                 for p in pvcs.get('items', []) if p['spec'].get('storageClassName') == 'pgcloud-block']
                  out['apiHealthy'] = 'ok' in sh('curl -sfk https://127.0.0.1:6443/healthz', check=False)
              except Exception as e:
                  out['error'] = str(e)[-300:]
          return out

      # ---- control plane upkeep: etcd snapshots daily, kubeadm certificates monthly ----
${indentBlock(AGENT_S3_PY, 6)}

      def etcd_snapshot(c, m):
          os.makedirs(SNAPSHOTS, exist_ok=True)
          cid = (sh(CRICTL + 'ps --name etcd -q', check=False).split() or [None])[0]
          if not cid: raise RuntimeError('etcd container not found')
          # etcd runs as a static pod with /var/lib/etcd mounted, so the snapshot lands on the host.
          sh(CRICTL + 'exec %s etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key snapshot save /var/lib/etcd/pgcloud-snapshot.db' % cid, timeout=600)
          name = 'etcd-%s-%s.db' % (m['name'], time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
          path = SNAPSHOTS + '/' + name
          shutil.move('/var/lib/etcd/pgcloud-snapshot.db', path); os.chmod(path, 0o600)
          if c.get('backup'):
              s3_put(c['backup'], c['cluster']['name'] + '/etcd/' + name, path); os.remove(path)
          # Local copies are kept for seven days.
          for f in glob.glob(SNAPSHOTS + '/etcd-*.db'):
              if time.time() - os.path.getmtime(f) > 7 * 86400: os.remove(f)
          return name

      def renew_certs():
          sh('kubeadm certs renew all', timeout=600)
          # Static pods read certificates at start: restart them one at a time so the node keeps serving.
          hold = '/etc/kubernetes/pgcloud-restart'; os.makedirs(hold, exist_ok=True)
          for pod in ('etcd', 'kube-apiserver', 'kube-controller-manager', 'kube-scheduler'):
              src = '/etc/kubernetes/manifests/%s.yaml' % pod
              if not os.path.exists(src): continue
              shutil.move(src, hold + '/' + pod + '.yaml'); time.sleep(20)
              shutil.move(hold + '/' + pod + '.yaml', src); time.sleep(30)

      def upkeep():
          while True:
              time.sleep(600)
              try:
                  c = last_config()
                  if not c or not initialized() or me(c)['role'] != 'control': continue
                  m = me(c); st = state(); now = time.time()
                  if now - st.get('etcdSnapshotAt', 0) > 86400:
                      try: update_state(etcdSnapshotAt=now, etcdSnapshot=etcd_snapshot(c, m), etcdSnapshotError=None)
                      except Exception as e: update_state(etcdSnapshotAt=now, etcdSnapshotError=str(e)[-300:]); log('etcd snapshot: ' + str(e)[-300:])
                  # Monthly, with control plane nodes a day apart so the API stays up behind the VIP.
                  if 'certsRenewedAt' not in st: update_state(certsRenewedAt=now)
                  elif now - st['certsRenewedAt'] > (30 + m['index']) * 86400:
                      try: renew_certs(); update_state(certsRenewedAt=now, certsError=None)
                      except Exception as e: update_state(certsRenewedAt=now - 29 * 86400, certsError=str(e)[-300:]); log('certificate renewal: ' + str(e)[-300:])
              except Exception as e:
                  log('upkeep: ' + str(e)[-300:])

      class H(http.server.BaseHTTPRequestHandler):
          def log_message(self, *a): pass
          def do_GET(self):
              if self.path != '/status': return self._send(404, {})
              if self.headers.get('X-Pgcloud-Secret') != SECRET: return self._send(401, {'error': 'unauthorized'})
              self._send(200, status())
          def do_POST(self):
              if self.headers.get('X-Pgcloud-Secret') != SECRET: return self._send(401, {'error': 'unauthorized'})
              n = int(self.headers.get('Content-Length') or 0); body = json.loads(self.rfile.read(n) or b'{}')
              if self.path == '/join-token':
                  # A fresh bootstrap token for nodes joining later, valid 24 hours.
                  if not os.path.exists('/etc/kubernetes/admin.conf'): return self._send(409, {'error': 'not_ready'})
                  try: return self._send(200, {'token': sh('kubeadm token create --ttl 24h').strip().split()[-1]})
                  except Exception as e: return self._send(500, {'error': 'token_failed', 'detail': str(e)[-300:]})
              if self.path in ('/renew-certs', '/etcd-snapshot'):
                  c = last_config()
                  if not c or not initialized() or me(c)['role'] != 'control': return self._send(409, {'error': 'not_control_plane'})
                  if self.path == '/renew-certs': threading.Thread(target=lambda: (renew_certs(), update_state(certsRenewedAt=time.time())), daemon=True).start()
                  else: threading.Thread(target=lambda: update_state(etcdSnapshotAt=time.time(), etcdSnapshot=etcd_snapshot(c, me(c))), daemon=True).start()
                  return self._send(202, {'started': True})
              if self.path == '/config':
                  with lock:
                      try:
                          json.dump(body, open(LAST, 'w')); os.chmod(LAST, 0o600)
                          apply(body)
                          update_state(version=body['version'])
                      except NotReady as e:
                          return self._send(409, {'error': 'not_ready', 'detail': str(e)})
                      except Exception as e:
                          return self._send(500, {'error': 'apply_failed', 'detail': str(e)[-800:]})
                  return self._send(200, {'version': body['version']})
              self._send(404, {})
          def _send(self, code, body):
              b = json.dumps(body).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
      threading.Thread(target=upkeep, daemon=True).start()
      http.server.ThreadingHTTPServer((bind_address(), 9009), H).serve_forever()
runcmd:
  - modprobe overlay && modprobe br_netfilter && sysctl --system
  - swapoff -a && sed -i '/ swap / s/^/#/' /etc/fstab
  - mkdir -p /etc/containerd && containerd config default | sed 's/SystemdCgroup = false/SystemdCgroup = true/' > /etc/containerd/config.toml && systemctl restart containerd
  - mkdir -p /etc/apt/keyrings && curl -fsSL https://pkgs.k8s.io/core:/stable:/v${d.version}/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
  - echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v${d.version}/deb/ /' > /etc/apt/sources.list.d/kubernetes.list
  - apt-get update -qq && apt-get install -y -qq kubelet kubeadm kubectl && apt-mark hold kubelet kubeadm kubectl
  - systemctl enable --now kubelet
  - systemctl daemon-reload && systemctl enable --now pgcloud-k8sd
`;
}
