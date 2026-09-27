import { agentNetPy } from '../../common/platform-agent';

/**
 * cloud-init for a managed database node. Installs the engine, its HA tooling and
 * `pgcloud-dbd`: an HTTP agent on :9009 that receives the whole node configuration from
 * the control plane (POST /config), writes etcd, Patroni, pgBouncer, pgBackRest and
 * keepalived config, applies users and databases on the primary, runs backups
 * (POST /backup) and reports role, members and lag (GET /status). Nothing on the node is
 * configured by hand; the first config push bootstraps the cluster.
 */
export interface DbNodeInit {
  engine: 'postgres' | 'valkey' | 'mysql';
  vmSecret: string;
  /**
   * Network the cluster VIP lives on: private for a private address, public for the public
   * address customers connect to today (see vipNetworkFor). VRRP itself always runs over the
   * private network.
   */
  vipNetwork: 'public' | 'private';
}

const PACKAGES: Record<DbNodeInit['engine'], string> = {
  postgres: '[postgresql-16, postgresql-contrib, postgresql-16-pgvector, patroni, etcd-server, etcd-client, pgbackrest, pgbouncer, keepalived, python3, python3-psycopg2, openssl]',
  valkey: '[valkey-server, valkey-sentinel, keepalived, python3, openssl]',
  mysql: '[mysql-server-8.0, percona-xtrabackup-80, keepalived, python3, openssl]',
};

export function renderDbCloudInit(d: DbNodeInit): string {
  return `#cloud-config
package_update: true
packages: ${PACKAGES[d.engine]}
write_files:
  - path: /etc/sysctl.d/90-pgcloud-db.conf
    content: |
      net.ipv4.ip_nonlocal_bind = 1
      vm.swappiness = 10
  - path: /opt/pgcloud/vm.secret
    permissions: '0600'
    content: '${d.vmSecret}'
  - path: /opt/pgcloud/engine
    content: '${d.engine}'
  - path: /opt/pgcloud/vip.network
    content: '${d.vipNetwork}'
  - path: /opt/pgcloud/dbd.py
    permissions: '0755'
    content: |
      #!/usr/bin/env python3
      # pgcloud managed database agent. The control plane is the only writer of configuration.
      import http.server, json, os, subprocess, threading, time, urllib.request
      SECRET = open('/opt/pgcloud/vm.secret').read().strip()
      ENGINE = open('/opt/pgcloud/engine').read().strip()
      STATE = '/opt/pgcloud/db.json'
      lock = threading.Lock()

${agentNetPy(6)}

      def state():
          try: return json.load(open(STATE))
          except Exception: return {'version': 0, 'backups': []}
      def save(st): json.dump(st, open(STATE, 'w'))
      def sh(cmd, check=True, **kw):
          return subprocess.run(cmd, shell=isinstance(cmd, str), check=check, capture_output=True, text=True, **kw)
      def write(path, text, mode=0o644, owner=None):
          os.makedirs(os.path.dirname(path), exist_ok=True)
          open(path, 'w').write(text); os.chmod(path, mode)
          if owner: sh(['chown', owner, path], check=False)
      def is_primary():
          try: return urllib.request.urlopen('http://127.0.0.1:8008/primary', timeout=3).status == 200
          except Exception: return False
      def ensure_cert():
          if not os.path.exists('/etc/pgcloud/server.crt'):
              os.makedirs('/etc/pgcloud', exist_ok=True)
              sh(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-subj', '/CN=pgcloud-db', '-keyout', '/etc/pgcloud/server.key', '-out', '/etc/pgcloud/server.crt'])
              sh('chown postgres:postgres /etc/pgcloud/server.* && chmod 600 /etc/pgcloud/server.key', check=False)

      # ---- postgres: etcd + patroni + pgbouncer + pgbackrest ----
      def apply_postgres(c):
          me = [n for n in c['cluster']['nodes'] if n['isSelf']][0]
          peers = ','.join(f"{n['name']}=http://{n['ip']}:2380" for n in c['cluster']['nodes'])
          write('/etc/default/etcd', f"ETCD_NAME={me['name']}\\nETCD_DATA_DIR=/var/lib/etcd/default\\nETCD_LISTEN_PEER_URLS=http://{me['ip']}:2380\\nETCD_LISTEN_CLIENT_URLS=http://{me['ip']}:2379,http://127.0.0.1:2379\\nETCD_INITIAL_ADVERTISE_PEER_URLS=http://{me['ip']}:2380\\nETCD_ADVERTISE_CLIENT_URLS=http://{me['ip']}:2379\\nETCD_INITIAL_CLUSTER={peers}\\nETCD_INITIAL_CLUSTER_STATE=new\\nETCD_INITIAL_CLUSTER_TOKEN={c['cluster']['name']}\\nETCD_ENABLE_V2=true\\n")
          sh('systemctl enable --now etcd && systemctl restart etcd', check=False)
          ensure_cert()
          hba = ['local all all peer', 'host all all 127.0.0.1/32 scram-sha-256']
          hba += [f"host replication replicator {n['ip']}/32 scram-sha-256" for n in c['cluster']['nodes']]
          hba += [f"host all all {n['ip']}/32 scram-sha-256" for n in c['cluster']['nodes']]
          hba += [f"hostssl all all {cidr} scram-sha-256" for cidr in (c.get('trustedSources') or ['0.0.0.0/0', '::/0'])]
          params = {'max_connections': 200, 'shared_buffers': c.get('params', {}).get('shared_buffers', '256MB'), 'ssl': 'on', 'ssl_cert_file': '/etc/pgcloud/server.crt', 'ssl_key_file': '/etc/pgcloud/server.key', 'wal_level': 'replica', 'archive_mode': 'on', 'archive_command': 'pgbackrest --stanza=main archive-push %p', 'password_encryption': 'scram-sha-256'}
          params.update(c.get('params', {}))
          patroni = {
              'scope': c['cluster']['name'], 'name': me['name'],
              'restapi': {'listen': '0.0.0.0:8008', 'connect_address': f"{me['ip']}:8008"},
              'etcd': {'hosts': [f"{n['ip']}:2379" for n in c['cluster']['nodes']]},
              'bootstrap': {'dcs': {'ttl': 30, 'loop_wait': 10, 'retry_timeout': 10, 'maximum_lag_on_failover': 1048576, 'postgresql': {'use_pg_rewind': True, 'parameters': params, 'pg_hba': hba}},
                            'initdb': ['encoding: UTF8', 'data-checksums'], 'post_bootstrap': '/opt/pgcloud/post-bootstrap.sh'},
              'postgresql': {'listen': '0.0.0.0:5432', 'connect_address': f"{me['ip']}:5432", 'data_dir': '/var/lib/postgresql/16/main', 'bin_dir': '/usr/lib/postgresql/16/bin', 'pgpass': '/tmp/pgpass',
                             'authentication': {'replication': {'username': 'replicator', 'password': c['replicationPassword']}, 'superuser': {'username': 'postgres', 'password': c['admin']['password']}},
                             'parameters': params, 'pg_hba': hba},
              'tags': {'nofailover': False, 'noloadbalance': False, 'clonefrom': False},
          }
          import yaml
          write('/etc/patroni/config.yml', yaml.safe_dump(patroni), 0o600, 'postgres:postgres')
          write('/opt/pgcloud/post-bootstrap.sh', "#!/bin/sh\\npsql -c \\"CREATE ROLE {0} WITH SUPERUSER LOGIN PASSWORD '{1}'\\" || true\\n".format(c['admin']['user'], c['admin']['password']), 0o755)
          b = c.get('backup') or {}
          if b.get('bucket'):
              write('/etc/pgbackrest/pgbackrest.conf', f"[main]\\npg1-path=/var/lib/postgresql/16/main\\n[global]\\nrepo1-type=s3\\nrepo1-s3-endpoint={b['endpoint']}\\nrepo1-s3-bucket={b['bucket']}\\nrepo1-s3-region={b['region']}\\nrepo1-s3-key={b['accessKey']}\\nrepo1-s3-key-secret={b['secretKey']}\\nrepo1-s3-uri-style=path\\nrepo1-path=/{c['cluster']['name']}\\nrepo1-retention-full=7\\nprocess-max=2\\nlog-level-console=info\\n", 0o600, 'postgres:postgres')
          keepalived(c, me, '/usr/bin/curl -sf http://127.0.0.1:8008/primary')
          sh('systemctl enable --now patroni keepalived && systemctl restart keepalived && (systemctl is-active patroni || systemctl restart patroni)', check=False)
          # pgbouncer in front, transaction pooling, auth through pg_authid.
          write('/etc/pgbouncer/pgbouncer.ini', f"[databases]\\n* = host=127.0.0.1 port=5432\\n[pgbouncer]\\nlisten_addr = 0.0.0.0\\nlisten_port = 6432\\nauth_type = scram-sha-256\\nauth_file = /etc/pgbouncer/userlist.txt\\nauth_user = {c['admin']['user']}\\nauth_query = SELECT usename, passwd FROM pg_shadow WHERE usename=$1\\npool_mode = transaction\\nmax_client_conn = 1000\\ndefault_pool_size = 20\\nclient_tls_sslmode = allow\\nclient_tls_cert_file = /etc/pgcloud/server.crt\\nclient_tls_key_file = /etc/pgcloud/server.key\\n")
          write('/etc/pgbouncer/userlist.txt', f"\\"{c['admin']['user']}\\" \\"{c['admin']['password']}\\"\\n", 0o600, 'postgres:postgres')
          sh('systemctl enable --now pgbouncer && systemctl restart pgbouncer', check=False)
          # Users and databases are applied on the primary only; replicas receive them by replication.
          for _ in range(60):
              if is_primary() or any(not n['isSelf'] for n in c['cluster']['nodes']): break
              time.sleep(2)
          if is_primary():
              env = dict(os.environ, PGPASSWORD=c['admin']['password'])
              def psql(sql, db='postgres'): return sh(['psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-c', sql], check=False, env=env)
              psql(f"ALTER ROLE {c['admin']['user']} WITH PASSWORD '{c['admin']['password']}'")
              for u in c.get('users', []):
                  psql(f"DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='{u['name']}') THEN CREATE ROLE {u['name']} LOGIN; END IF; END $$;")
                  psql(f"ALTER ROLE {u['name']} WITH LOGIN PASSWORD '{u['password']}' CREATEDB")
              for d in c.get('databases', []):
                  r = psql(f"SELECT 1 FROM pg_database WHERE datname='{d}'")
                  if '1' not in r.stdout.split('\\n')[2:3][0] if len(r.stdout.split('\\n')) > 2 else True: psql(f"CREATE DATABASE {d}")
                  for u in c.get('users', []): psql(f"GRANT ALL PRIVILEGES ON DATABASE {d} TO {u['name']}")
                  psql("CREATE EXTENSION IF NOT EXISTS vector", d)
              if b.get('bucket') and not os.path.exists('/var/lib/pgbackrest/.stanza'):
                  r = sh('sudo -u postgres pgbackrest --stanza=main stanza-create', check=False)
                  if r.returncode == 0: os.makedirs('/var/lib/pgbackrest', exist_ok=True); open('/var/lib/pgbackrest/.stanza', 'w').write('ok')

      def status_postgres():
          out = {'role': 'primary' if is_primary() else 'replica', 'members': [], 'lagBytes': None, 'dbSizes': {}}
          try:
              cl = json.load(urllib.request.urlopen('http://127.0.0.1:8008/cluster', timeout=3))
              out['members'] = [{'name': m.get('name'), 'role': m.get('role'), 'state': m.get('state'), 'lag': m.get('lag')} for m in cl.get('members', [])]
              me = [m for m in cl.get('members', []) if m.get('name') == os.uname().nodename]
              if me and isinstance(me[0].get('lag'), int): out['lagBytes'] = me[0]['lag']
          except Exception: pass
          try:
              env = dict(os.environ, PGPASSWORD=open('/opt/pgcloud/admin.pw').read().strip())
              r = sh(['psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-At', '-c', "SELECT datname, pg_database_size(datname) FROM pg_database WHERE NOT datistemplate"], check=False, env=env)
              for line in r.stdout.splitlines():
                  n, s = line.split('|'); out['dbSizes'][n] = int(s)
          except Exception: pass
          st = os.statvfs('/var/lib/postgresql')
          out['diskUsedPercent'] = round(100 * (1 - st.f_bavail / st.f_blocks), 1)
          return out

      def backup_postgres(bid):
          st = state(); rec = {'id': bid, 'status': 'running', 'startedAt': time.time()}
          st['backups'] = [b for b in st.get('backups', []) if b['id'] != bid] + [rec]; save(st)
          r = sh('sudo -u postgres pgbackrest --stanza=main --type=full backup', check=False)
          rec['status'] = 'completed' if r.returncode == 0 else 'failed'; rec['completedAt'] = time.time(); rec['error'] = (r.stderr or '')[-500:] if r.returncode else None
          try:
              info = json.loads(sh('sudo -u postgres pgbackrest --stanza=main info --output=json', check=False).stdout)
              rec['sizeBytes'] = info[0]['backup'][-1]['info']['repository']['size']
          except Exception: pass
          st = state(); st['backups'] = [b for b in st.get('backups', []) if b['id'] != bid] + [rec]; save(st)

      # ---- shared: SigV4 PUT of a file to the platform backup bucket ----
      def s3_put(b, key, path):
          import hashlib, hmac, datetime, urllib.parse
          from urllib.parse import urlparse
          u = urlparse(b['endpoint']); host = u.netloc; base = u.path.rstrip('/')
          body = open(path, 'rb').read(); now = datetime.datetime.utcnow(); amz = now.strftime('%Y%m%dT%H%M%SZ'); day = now.strftime('%Y%m%d')
          ph = hashlib.sha256(body).hexdigest(); canonical_uri = f"{base}/{b['bucket']}/{urllib.parse.quote(key)}"
          headers = {'host': host, 'x-amz-content-sha256': ph, 'x-amz-date': amz}
          signed = ';'.join(sorted(headers)); ch = ''.join(f"{k}:{headers[k]}\\n" for k in sorted(headers))
          creq = '\\n'.join(['PUT', canonical_uri, '', ch, signed, ph]); scope = f"{day}/{b['region']}/s3/aws4_request"
          sts = '\\n'.join(['AWS4-HMAC-SHA256', amz, scope, hashlib.sha256(creq.encode()).hexdigest()])
          def h(k, m): return hmac.new(k, m.encode(), hashlib.sha256).digest()
          sig = hmac.new(h(h(h(h(('AWS4' + b['secretKey']).encode(), day), b['region']), 's3'), 'aws4_request'), sts.encode(), hashlib.sha256).hexdigest()
          headers['Authorization'] = f"AWS4-HMAC-SHA256 Credential={b['accessKey']}/{scope}, SignedHeaders={signed}, Signature={sig}"
          req = urllib.request.Request(f"{u.scheme}://{host}{canonical_uri}", data=body, method='PUT', headers=headers)
          urllib.request.urlopen(req, timeout=600).read()
          return len(body)

      def keepalived(c, me, check):
          # VRRP runs unicast between the nodes over the private network; the VIP sits on the
          # interface named by /opt/pgcloud/vip.network.
          peers = [n['ip'] for n in c['cluster']['nodes'] if not n['isSelf']]
          uni = ("  unicast_src_ip %s\\n  unicast_peer { %s }\\n" % (private_ipv4() or me['ip'], ' '.join(peers))) if peers else ''
          text = "vrrp_script chk_primary {\\n  script \\"%s\\"\\n  interval 2\\n  fall 2\\n  rise 2\\n}\\nvrrp_instance VI_db {\\n  state BACKUP\\n  interface %s\\n  virtual_router_id %d\\n  priority %d\\n  advert_int 1\\n  nopreempt\\n%s  authentication { auth_type PASS auth_pass %s }\\n  virtual_ipaddress { %s/%d dev %s }\\n  track_script { chk_primary }\\n}\\n" % (check, private_iface() or 'eth0', c['cluster']['vrid'], 100 - me['index'], uni, c['cluster']['vrrpPass'], c['cluster']['vip'], c['cluster']['prefix'], vip_iface())
          if os.path.exists('/etc/keepalived/keepalived.conf') and open('/etc/keepalived/keepalived.conf').read() == text: return
          write('/etc/keepalived/keepalived.conf', text)
          sh('systemctl enable --now keepalived && systemctl restart keepalived', check=False)

      # ---- valkey: replication plus sentinel on three nodes, ACL users, RDB backups ----
      def apply_valkey(c):
          me = [n for n in c['cluster']['nodes'] if n['isSelf']][0]
          primary = min(c['cluster']['nodes'], key=lambda n: n['index'])
          pw = c['admin']['password']
          ensure_cert()
          conf = [f"bind 0.0.0.0", "port 6379", "protected-mode yes", f"requirepass {pw}", f"masterauth {pw}", "appendonly yes", "dir /var/lib/valkey", "maxmemory-policy allkeys-lru",
                  "tls-port 6380", "tls-cert-file /etc/pgcloud/server.crt", "tls-key-file /etc/pgcloud/server.key", "tls-auth-clients no", "tls-replication no"]
          if not me['index'] == primary['index'] and not is_valkey_primary_by_sentinel(c, me):
              conf.append(f"replicaof {primary['ip']} 6379")
          write('/etc/valkey/valkey.conf', '\\n'.join(conf) + '\\n', 0o640, 'valkey:valkey')
          write('/opt/pgcloud/acl.txt', '\\n'.join([f"user default on >{pw} ~* &* +@all"] + [f"user {u['name']} on >{u['password']} ~* &* +@all -@dangerous" for u in c.get('users', [])]) + '\\n', 0o600, 'valkey:valkey')
          sh("grep -q aclfile /etc/valkey/valkey.conf || echo 'aclfile /opt/pgcloud/acl.txt' >> /etc/valkey/valkey.conf", check=False)
          sh('systemctl enable --now valkey-server && systemctl restart valkey-server', check=False)
          if len(c['cluster']['nodes']) > 1:
              write('/etc/valkey/sentinel.conf', f"port 26379\\nbind 0.0.0.0\\nsentinel monitor main {primary['ip']} 6379 2\\nsentinel auth-pass main {pw}\\nsentinel down-after-milliseconds main 5000\\nsentinel failover-timeout main 60000\\nsentinel parallel-syncs main 1\\n", 0o640, 'valkey:valkey')
              sh('systemctl enable --now valkey-sentinel && systemctl restart valkey-sentinel', check=False)
          keepalived(c, me, f"/usr/bin/valkey-cli -a {pw} role | head -1 | grep -q master")
          # Sentinel must know new passwords too; users live in the ACL file loaded at start.
          sh(f"valkey-cli -a {pw} ACL LOAD", check=False)
      def is_valkey_primary_by_sentinel(c, me):
          try:
              r = sh(['valkey-cli', '-p', '26379', 'SENTINEL', 'get-master-addr-by-name', 'main'], check=False)
              return r.stdout.splitlines()[0].strip() == me['ip']
          except Exception: return False
      def status_valkey():
          pw = open('/opt/pgcloud/admin.pw').read().strip()
          role = sh(['valkey-cli', '-a', pw, 'role'], check=False).stdout.splitlines()
          out = {'role': 'primary' if role and role[0].strip() == 'master' else 'replica', 'members': [], 'lagBytes': None, 'dbSizes': {}}
          info = sh(['valkey-cli', '-a', pw, 'info', 'replication'], check=False).stdout
          for line in info.splitlines():
              if line.startswith('master_repl_offset:'): out['masterOffset'] = int(line.split(':')[1])
              if line.startswith('slave_repl_offset:'): out['lagBytes'] = max(0, out.get('masterOffset', 0) - int(line.split(':')[1]))
          mem = sh(['valkey-cli', '-a', pw, 'info', 'memory'], check=False).stdout
          for line in mem.splitlines():
              if line.startswith('used_memory:'): out['dbSizes']['default'] = int(line.split(':')[1])
          st = os.statvfs('/var/lib/valkey'); out['diskUsedPercent'] = round(100 * (1 - st.f_bavail / st.f_blocks), 1)
          return out
      def backup_valkey(bid):
          st = state(); rec = {'id': bid, 'status': 'running', 'startedAt': time.time()}
          st['backups'] = [b for b in st.get('backups', []) if b['id'] != bid] + [rec]; save(st)
          try:
              pw = open('/opt/pgcloud/admin.pw').read().strip(); cfg = json.load(open('/opt/pgcloud/last-config.json'))
              sh(['valkey-cli', '-a', pw, '--rdb', f'/var/lib/valkey/backup-{bid}.rdb'])
              rec['sizeBytes'] = s3_put(cfg['backup'], f"{cfg['cluster']['name']}/{bid}.rdb", f'/var/lib/valkey/backup-{bid}.rdb'); os.remove(f'/var/lib/valkey/backup-{bid}.rdb')
              rec['status'] = 'completed'
          except Exception as e:
              rec['status'] = 'failed'; rec['error'] = str(e)[-500:]
          rec['completedAt'] = time.time(); st = state(); st['backups'] = [b for b in st.get('backups', []) if b['id'] != bid] + [rec]; save(st)

      # ---- mysql: GTID replication with agent driven promotion, xtrabackup streamed to the bucket ----
      def apply_mysql(c):
          me = [n for n in c['cluster']['nodes'] if n['isSelf']][0]
          primary = min(c['cluster']['nodes'], key=lambda n: n['index'])
          pw = c['admin']['password']
          ensure_cert()
          write('/etc/mysql/mysql.conf.d/zz-pgcloud.cnf', f"[mysqld]\\nbind-address = 0.0.0.0\\nserver-id = {me['index'] + 1}\\ngtid_mode = ON\\nenforce_gtid_consistency = ON\\nlog_bin = binlog\\nbinlog_expire_logs_seconds = 604800\\nrelay_log = relay\\nread_only = {'OFF' if me['index'] == primary['index'] else 'ON'}\\nrequire_secure_transport = ON\\nssl_cert = /etc/pgcloud/server.crt\\nssl_key = /etc/pgcloud/server.key\\ninnodb_buffer_pool_size = {c.get('params', {}).get('innodb_buffer_pool_size', '256M')}\\n")
          sh('chown mysql:mysql /etc/pgcloud/server.* ; systemctl enable --now mysql && systemctl restart mysql', check=False)
          def q(sql): return sh(['mysql', '-uroot', '-e', sql], check=False)
          q(f"ALTER USER 'root'@'localhost' IDENTIFIED BY '{pw}'") if q("SELECT 1").returncode == 0 else None
          def qa(sql): return sh(['mysql', '-uroot', f'-p{pw}', '-e', sql], check=False)
          qa(f"CREATE USER IF NOT EXISTS '{c['admin']['user']}'@'%' IDENTIFIED BY '{pw}'; ALTER USER '{c['admin']['user']}'@'%' IDENTIFIED BY '{pw}'; GRANT ALL ON *.* TO '{c['admin']['user']}'@'%' WITH GRANT OPTION;")
          qa(f"CREATE USER IF NOT EXISTS 'replicator'@'%' IDENTIFIED BY '{c['replicationPassword']}'; ALTER USER 'replicator'@'%' IDENTIFIED BY '{c['replicationPassword']}'; GRANT REPLICATION SLAVE ON *.* TO 'replicator'@'%';")
          if me['index'] == primary['index']:
              for u in c.get('users', []):
                  qa(f"CREATE USER IF NOT EXISTS '{u['name']}'@'%' IDENTIFIED BY '{u['password']}'; ALTER USER '{u['name']}'@'%' IDENTIFIED BY '{u['password']}';")
              for d in c.get('databases', []):
                  qa(f"CREATE DATABASE IF NOT EXISTS \`{d}\`")
                  for u in c.get('users', []): qa(f"GRANT ALL ON \`{d}\`.* TO '{u['name']}'@'%'")
          else:
              qa(f"STOP REPLICA; CHANGE REPLICATION SOURCE TO SOURCE_HOST='{primary['ip']}', SOURCE_USER='replicator', SOURCE_PASSWORD='{c['replicationPassword']}', SOURCE_AUTO_POSITION=1, SOURCE_SSL=1; START REPLICA;")
          keepalived(c, me, f"/usr/bin/mysql -uroot -p{pw} -N -e 'SELECT @@read_only' | grep -q 0")
      def status_mysql():
          pw = open('/opt/pgcloud/admin.pw').read().strip()
          ro = sh(['mysql', '-uroot', f'-p{pw}', '-N', '-e', 'SELECT @@read_only'], check=False).stdout.strip()
          out = {'role': 'primary' if ro == '0' else 'replica', 'members': [], 'lagBytes': None, 'dbSizes': {}}
          r = sh(['mysql', '-uroot', f'-p{pw}', '-N', '-e', 'SHOW REPLICA STATUS\\G'], check=False).stdout
          for line in r.splitlines():
              if 'Seconds_Behind_Source' in line and line.split(':')[-1].strip().isdigit(): out['lagSeconds'] = int(line.split(':')[-1].strip())
          for line in sh(['mysql', '-uroot', f'-p{pw}', '-N', '-e', "SELECT table_schema, SUM(data_length+index_length) FROM information_schema.tables GROUP BY table_schema"], check=False).stdout.splitlines():
              n, sz = line.split('\t'); out['dbSizes'][n] = int(sz or 0)
          st = os.statvfs('/var/lib/mysql'); out['diskUsedPercent'] = round(100 * (1 - st.f_bavail / st.f_blocks), 1)
          return out
      def backup_mysql(bid):
          st = state(); rec = {'id': bid, 'status': 'running', 'startedAt': time.time()}
          st['backups'] = [b for b in st.get('backups', []) if b['id'] != bid] + [rec]; save(st)
          try:
              pw = open('/opt/pgcloud/admin.pw').read().strip(); b = json.load(open('/opt/pgcloud/last-config.json'))['backup']; name = json.load(open('/opt/pgcloud/last-config.json'))['cluster']['name']
              r = sh(f"xtrabackup --backup --stream=xbstream --user=root --password='{pw}' 2>/var/log/pgcloud-xtrabackup.log | xbcloud put --storage=s3 --s3-endpoint='{b['endpoint']}' --s3-access-key='{b['accessKey']}' --s3-secret-key='{b['secretKey']}' --s3-bucket='{b['bucket']}' --s3-region='{b['region']}' --parallel=2 '{name}/{bid}'", check=False)
              if r.returncode != 0: raise RuntimeError((r.stderr or '')[-500:])
              rec['status'] = 'completed'
          except Exception as e:
              rec['status'] = 'failed'; rec['error'] = str(e)[-500:]
          rec['completedAt'] = time.time(); st = state(); st['backups'] = [b for b in st.get('backups', []) if b['id'] != bid] + [rec]; save(st)

      APPLY = {'postgres': apply_postgres, 'valkey': apply_valkey, 'mysql': apply_mysql}
      STATUS = {'postgres': status_postgres, 'valkey': status_valkey, 'mysql': status_mysql}
      BACKUP = {'postgres': backup_postgres, 'valkey': backup_valkey, 'mysql': backup_mysql}

      class H(http.server.BaseHTTPRequestHandler):
          def log_message(self, *a): pass
          def do_GET(self):
              if self.headers.get('X-Pgcloud-Secret') != SECRET: return self._send(401, {'error': 'unauthorized'})
              if self.path != '/status': return self._send(404, {})
              st = state()
              self._send(200, {'version': st.get('version', 0), 'engine': ENGINE, 'backups': st.get('backups', []), **STATUS[ENGINE]()})
          def do_POST(self):
              if self.headers.get('X-Pgcloud-Secret') != SECRET: return self._send(401, {'error': 'unauthorized'})
              n = int(self.headers.get('Content-Length') or 0); body = json.loads(self.rfile.read(n) or b'{}')
              if self.path == '/config':
                  with lock:
                      try:
                          open('/opt/pgcloud/admin.pw', 'w').write(body['admin']['password']); os.chmod('/opt/pgcloud/admin.pw', 0o600)
                          json.dump(body, open('/opt/pgcloud/last-config.json', 'w')); os.chmod('/opt/pgcloud/last-config.json', 0o600)
                          APPLY[ENGINE](body)
                          st = state(); st['version'] = body['version']; save(st)
                      except Exception as e:
                          return self._send(500, {'error': 'apply_failed', 'detail': str(e)[-800:]})
                  return self._send(200, {'version': body['version']})
              if self.path == '/backup':
                  if STATUS[ENGINE]().get('role') != 'primary': return self._send(409, {'error': 'not_primary'})
                  threading.Thread(target=BACKUP[ENGINE], args=(body['id'],), daemon=True).start()
                  return self._send(202, {'id': body['id']})
              self._send(404, {})
          def _send(self, code, body):
              b = json.dumps(body).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
      http.server.ThreadingHTTPServer((bind_address(), 9009), H).serve_forever()
  - path: /etc/systemd/system/pgcloud-dbd.service
    content: |
      [Unit]
      Description=pgcloud managed database agent
      After=network-online.target
      [Service]
      ExecStart=/opt/pgcloud/dbd.py
      Restart=always
      [Install]
      WantedBy=multi-user.target
runcmd:
  - sysctl --system
  - systemctl disable --now postgresql || true
  - pip3 install --break-system-packages pyyaml 2>/dev/null || apt-get install -y python3-yaml
  - systemctl enable --now pgcloud-dbd
`;
}
