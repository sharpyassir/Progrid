import { agentNetPy } from '../../common/platform-agent';

/**
 * cloud-init for a managed Kubernetes node (control plane or worker; the role comes with
 * the first config push). Installs containerd, kubeadm, kubelet and kubectl from the
 * upstream package repository for the cluster's minor version, plus `pgcloud-k8sd`: an HTTP
 * agent on :9009 that receives the node's configuration from the control plane
 * (POST /config) and reports state (GET /status).
 *
 * What the agent does with a config:
 *   control plane, index 0   kubeadm init behind the VIP, install the CNI (flannel), the
 *                            pgcloud-block StorageClass, keep the join token alive, upload
 *                            certificates for the other control plane nodes, label and taint
 *                            nodes, patch LoadBalancer Services with the addresses the
 *                            platform assigned, create PersistentVolumes for block volumes
 *                            the platform attached, and remove nodes that left the cluster
 *   control plane, others    kubeadm join --control-plane
 *   workers                  kubeadm join, then format and mount block volumes assigned to
 *                            them under /var/lib/pgcloud/volumes/<id>
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
      import base64, glob, http.server, json, os, subprocess, threading, time
      SECRET = open('/opt/pgcloud/vm.secret').read().strip()
      STATE = '/opt/pgcloud/state.json'
      LAST = '/opt/pgcloud/last-config.json'
      lock = threading.Lock()

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
                 'apiServer': {'certSANs': [c['cluster']['vip'], m['ip'], m['name']]}}
          init = {'apiVersion': 'kubeadm.k8s.io/v1beta4', 'kind': 'InitConfiguration', 'certificateKey': c['certKey'],
                  'bootstrapTokens': [{'token': c['joinToken'], 'ttl': '0s'}],
                  'localAPIEndpoint': {'advertiseAddress': m['ip']}, 'nodeRegistration': {'name': m['name']}}
          write('/opt/pgcloud/kubeadm.json', json.dumps(cfg) + '\\n---\\n' + json.dumps(init), 0o600)
          sh('kubeadm init --config /opt/pgcloud/kubeadm.json --upload-certs', timeout=1200)
          kubectl('apply -f https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml')
          kubectl('apply -f -', inp=json.dumps({'apiVersion': 'storage.k8s.io/v1', 'kind': 'StorageClass', 'metadata': {'name': 'pgcloud-block', 'annotations': {'storageclass.kubernetes.io/is-default-class': 'true'}}, 'provisioner': 'pgcloud.dev/block', 'volumeBindingMode': 'WaitForFirstConsumer', 'reclaimPolicy': 'Delete'}))

      def join(c, m, control):
          extra = ' --control-plane --certificate-key ' + c['certKey'] + ' --apiserver-advertise-address ' + m['ip'] if control else ''
          sh('kubeadm join %s --token %s --discovery-token-ca-cert-hash sha256:%s --node-name %s%s' % (c['cluster']['endpoint'], c['joinToken'], c['caHash'], m['name'], extra), timeout=1200)

      def reconcile_control(c):
          # Bootstrap token and certificate key must stay usable for nodes that join later.
          sh('kubeadm token create %s --ttl 0 2>/dev/null || true' % c['joinToken'], check=False)
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
              st = state(); st['mounted'] = mount_volumes(c); save(st)

      class NotReady(Exception): pass

      def status():
          st = state(); c = None
          try: c = json.load(open(LAST))
          except Exception: pass
          out = {'version': st.get('version', 0), 'initialized': initialized(), 'mounted': st.get('mounted', []), 'role': me(c)['role'] if c else None, 'index': me(c)['index'] if c else None}
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
                  out['pvcs'] = [{'namespace': p['metadata']['namespace'], 'name': p['metadata']['name'], 'uid': p['metadata']['uid'], 'phase': p['status'].get('phase'),
                                  'sizeGb': int(str(p['spec']['resources']['requests'].get('storage', '10Gi')).rstrip('Gi') or 10),
                                  'node': p['metadata'].get('annotations', {}).get('volume.kubernetes.io/selected-node')}
                                 for p in pvcs.get('items', []) if p['spec'].get('storageClassName') == 'pgcloud-block']
                  out['apiHealthy'] = 'ok' in sh('curl -sfk https://127.0.0.1:6443/healthz', check=False)
              except Exception as e:
                  out['error'] = str(e)[-300:]
          return out

      class H(http.server.BaseHTTPRequestHandler):
          def log_message(self, *a): pass
          def do_GET(self):
              if self.path != '/status': return self._send(404, {})
              if self.headers.get('X-Pgcloud-Secret') != SECRET: return self._send(401, {'error': 'unauthorized'})
              self._send(200, status())
          def do_POST(self):
              if self.headers.get('X-Pgcloud-Secret') != SECRET: return self._send(401, {'error': 'unauthorized'})
              n = int(self.headers.get('Content-Length') or 0); body = json.loads(self.rfile.read(n) or b'{}')
              if self.path == '/config':
                  with lock:
                      try:
                          json.dump(body, open(LAST, 'w')); os.chmod(LAST, 0o600)
                          apply(body)
                          st = state(); st['version'] = body['version']; save(st)
                      except NotReady as e:
                          return self._send(409, {'error': 'not_ready', 'detail': str(e)})
                      except Exception as e:
                          return self._send(500, {'error': 'apply_failed', 'detail': str(e)[-800:]})
                  return self._send(200, {'version': body['version']})
              self._send(404, {})
          def _send(self, code, body):
              b = json.dumps(body).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
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
