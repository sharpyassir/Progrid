import { AGENT_NET_PY, AGENT_S3_PY } from '../../common/platform-agent';

/**
 * cloud-init for a managed database node. Installs the engine, its HA tooling and
 * `pgcloud-dbd`: an HTTP agent on the private address, port 9009, that receives the whole
 * node configuration from the control plane (POST /config), writes etcd, Patroni, pgBouncer,
 * pgBackRest and keepalived config, applies users and databases on the primary, runs backups
 * (POST /backup) and restores (POST /restore), and reports role, members, lag and restore
 * progress (GET /status). Every request carries the shared secret. Nothing on the node is
 * configured by hand; the first config push bootstraps the cluster.
 *
 * A config push answers 409 while the node waits for something outside it (a primary to be
 * elected, users to replicate), so the control plane records the version as applied only
 * once the node really has it.
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
  postgres: '[postgresql-16, postgresql-contrib, postgresql-16-pgvector, patroni, etcd-server, etcd-client, pgbackrest, pgbouncer, keepalived, python3, python3-yaml, python3-psycopg2, openssl, curl]',
  // valkey-server and valkey-sentinel are installed in runcmd so a missing package cannot fail the whole list.
  valkey: '[keepalived, python3, openssl, curl]',
  // percona-xtrabackup-80 comes from the Percona repository, added in runcmd.
  mysql: '[mysql-server-8.0, keepalived, python3, openssl, curl]',
};

/** Engine specific install steps, run before the agent starts. */
const RUNCMD: Record<DbNodeInit['engine'], string[]> = {
  postgres: [
    // The Ubuntu package creates a default 16/main cluster in the data directory Patroni bootstraps.
    'systemctl disable --now postgresql || true',
    'pg_dropcluster 16 main --stop || true',
  ],
  valkey: [
    // Ubuntu 24.04 carries valkey in universe. When the mirror in use lacks it, install from the Percona Valkey repository.
    'apt-get install -y -qq valkey-server valkey-sentinel || (curl -fsSL -o /tmp/percona-release.deb https://repo.percona.com/apt/percona-release_latest.generic_all.deb && apt-get install -y -qq /tmp/percona-release.deb && percona-release enable valkey release && apt-get update -qq && apt-get install -y -qq valkey-server valkey-sentinel)',
    // Sentinel starts once the agent has written its configuration.
    'systemctl disable --now valkey-sentinel || true',
  ],
  mysql: [
    'curl -fsSL -o /tmp/percona-release.deb https://repo.percona.com/apt/percona-release_latest.generic_all.deb && apt-get install -y -qq /tmp/percona-release.deb',
    'percona-release enable-only tools release && apt-get update -qq && apt-get install -y -qq percona-xtrabackup-80',
  ],
};

/** The agent, standard library only (plus PyYAML on Postgres nodes, which Patroni needs anyway). */
const DBD_PY = String.raw`#!/usr/bin/env python3
# pgcloud managed database agent. The control plane is the only writer of configuration.
import http.server, json, os, shutil, subprocess, threading, time, urllib.request, urllib.parse
SECRET = open('/opt/pgcloud/vm.secret').read().strip()
ENGINE = open('/opt/pgcloud/engine').read().strip()
STATE = '/opt/pgcloud/db.json'
LAST = '/opt/pgcloud/last-config.json'
LOG = '/var/log/pgcloud-dbd.log'
lock = threading.Lock()
slock = threading.Lock()
BT = chr(96)

class NotReady(Exception): pass

@@NET@@

def log(msg):
    try: open(LOG, 'a').write(time.strftime('%Y-%m-%dT%H:%M:%SZ ', time.gmtime()) + msg + '\n')
    except Exception: pass
def state():
    try: return json.load(open(STATE))
    except Exception: return {'version': 0, 'backups': []}
def save(st): json.dump(st, open(STATE, 'w'))
def update_state(**kw):
    with slock:
        st = state(); st.update(kw); save(st)
def record_backup(rec):
    with slock:
        st = state(); st['backups'] = ([b for b in st.get('backups', []) if b['id'] != rec['id']] + [rec])[-30:]; save(st)
def last_config():
    try: return json.load(open(LAST))
    except Exception: return None
def restoring():
    return (state().get('restore') or {}).get('status') == 'running'
def sh(cmd, check=True, **kw):
    return subprocess.run(cmd, shell=isinstance(cmd, str), check=check, capture_output=True, text=True, **kw)
def write(path, text, mode=0o644, owner=None):
    # True when the content changed, so callers restart services only when they must.
    os.makedirs(os.path.dirname(path), exist_ok=True)
    old = open(path).read() if os.path.exists(path) else None
    if old != text: open(path, 'w').write(text)
    os.chmod(path, mode)
    if owner: sh(['chown', owner, path], check=False)
    return old != text
def render(path, text, mode=0o644, owner=None):
    # Like write, for files a service rewrites itself: compare with what the agent wrote last.
    shadow = '/opt/pgcloud/rendered' + path
    old = open(shadow).read() if os.path.exists(shadow) else None
    if old == text and os.path.exists(path): return False
    write(path, text, mode, owner); write(shadow, text, 0o600)
    return True
def self_node(c): return [n for n in c['cluster']['nodes'] if n['isSelf']][0]
def ensure_cert():
    if not os.path.exists('/etc/pgcloud/server.crt'):
        os.makedirs('/etc/pgcloud', exist_ok=True)
        sh(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-subj', '/CN=pgcloud-db', '-keyout', '/etc/pgcloud/server.key', '-out', '/etc/pgcloud/server.crt'])
    owner = {'postgres': 'postgres:postgres', 'valkey': 'valkey:valkey', 'mysql': 'mysql:mysql'}[ENGINE]
    sh('chown %s /etc/pgcloud/server.* && chmod 600 /etc/pgcloud/server.key' % owner, check=False)
def disk_used(path):
    st = os.statvfs(path)
    return round(100 * (1 - st.f_bavail / st.f_blocks), 1)

@@S3@@
def s3_host(b):
    # pgBackRest wants a bare host name: no scheme, port or path.
    u = urllib.parse.urlparse(b['endpoint']); return u.hostname, u.port

def keepalived(c, me, check):
    # VRRP runs unicast between the nodes over the private network; the VIP sits on the
    # interface named by /opt/pgcloud/vip.network.
    peers = [n['ip'] for n in c['cluster']['nodes'] if not n['isSelf']]
    uni = ("  unicast_src_ip %s\n  unicast_peer { %s }\n" % (private_ipv4() or me['ip'], ' '.join(peers))) if peers else ''
    text = "vrrp_script chk_primary {\n  script \"%s\"\n  interval 2\n  fall 2\n  rise 2\n}\nvrrp_instance VI_db {\n  state BACKUP\n  interface %s\n  virtual_router_id %d\n  priority %d\n  advert_int 1\n  nopreempt\n%s  authentication { auth_type PASS auth_pass %s }\n  virtual_ipaddress { %s/%d dev %s }\n  track_script { chk_primary }\n}\n" % (check, private_iface() or 'eth0', c['cluster']['vrid'], 100 - me['index'], uni, c['cluster']['vrrpPass'], c['cluster']['vip'], c['cluster']['prefix'], vip_iface())
    if write('/etc/keepalived/keepalived.conf', text, 0o600) or sh('systemctl is-active --quiet keepalived', check=False).returncode:
        sh('systemctl enable keepalived && systemctl restart keepalived', check=False)

# ---- postgres: etcd + patroni + pgbouncer + pgbackrest ----
PG_DATA = '/var/lib/postgresql/16/main'
PG_BIN = '/usr/lib/postgresql/16/bin'
PATRONICTL = 'patronictl -c /etc/patroni/config.yml '
ARCHIVE_CMD = 'pgbackrest --stanza=main archive-push %p'
def is_primary():
    try: return urllib.request.urlopen('http://127.0.0.1:8008/primary', timeout=3).status == 200
    except Exception: return False
def patroni_cluster():
    try: return json.load(urllib.request.urlopen('http://127.0.0.1:8008/cluster', timeout=3))
    except Exception: return None
def has_leader():
    cl = patroni_cluster()
    return bool(cl) and any(m.get('role') in ('leader', 'master', 'primary') and m.get('state') == 'running' for m in cl.get('members', []))
def pg(sql, db='postgres'):
    # Local superuser through the socket (peer authentication): no password involved.
    return sh(['runuser', '-u', 'postgres', '--', 'psql', '-d', db, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], check=False)
def pg_missing(c):
    roles = pg('SELECT rolname FROM pg_roles'); dbs = pg('SELECT datname FROM pg_database')
    if roles.returncode or dbs.returncode: return ['the local server to accept connections']
    have_roles = set(roles.stdout.split()); have_dbs = set(dbs.stdout.split())
    want_roles = [c['admin']['user']] + [u['name'] for u in c.get('users', [])]
    return [r for r in want_roles if r not in have_roles] + [d for d in c.get('databases', []) if d not in have_dbs]
def member_name():
    c = last_config()
    return self_node(c)['name'] if c else None

def apply_postgres(c):
    me = self_node(c); nodes = c['cluster']['nodes']; pw = c['admin']['password']
    peers = ','.join(f"{n['name']}=http://{n['ip']}:2380" for n in nodes)
    if write('/etc/default/etcd', f"ETCD_NAME={me['name']}\nETCD_DATA_DIR=/var/lib/etcd/default\nETCD_LISTEN_PEER_URLS=http://{me['ip']}:2380\nETCD_LISTEN_CLIENT_URLS=http://{me['ip']}:2379,http://127.0.0.1:2379\nETCD_INITIAL_ADVERTISE_PEER_URLS=http://{me['ip']}:2380\nETCD_ADVERTISE_CLIENT_URLS=http://{me['ip']}:2379\nETCD_INITIAL_CLUSTER={peers}\nETCD_INITIAL_CLUSTER_STATE=new\nETCD_INITIAL_CLUSTER_TOKEN={c['cluster']['name']}\nETCD_ENABLE_V2=true\n"):
        # No waiting: a new member blocks until its peers are up, and they are configured one at a time.
        sh('systemctl enable etcd && systemctl restart --no-block etcd', check=False)
    ensure_cert()
    hba = ['local all all peer', 'host all all 127.0.0.1/32 scram-sha-256']
    hba += [f"host replication replicator {n['ip']}/32 scram-sha-256" for n in nodes]
    hba += [f"host all all {n['ip']}/32 scram-sha-256" for n in nodes]
    hba += [f"hostssl all all {cidr} scram-sha-256" for cidr in (c.get('trustedSources') or ['0.0.0.0/0', '::/0'])]
    params = {'max_connections': 200, 'shared_buffers': '256MB', 'ssl': 'on', 'ssl_cert_file': '/etc/pgcloud/server.crt', 'ssl_key_file': '/etc/pgcloud/server.key', 'wal_level': 'replica', 'archive_mode': 'on', 'password_encryption': 'scram-sha-256'}
    params.update(c.get('params', {}))
    # archive_command lives only in Patroni's dynamic configuration: a no-op until the pgBackRest
    # stanza exists, then switched on by archiving(). The local config must not override it.
    params.pop('archive_command', None)
    dcs_params = dict(params, archive_command='/bin/true')
    patroni = {
        'scope': c['cluster']['name'], 'name': me['name'],
        'restapi': {'listen': '0.0.0.0:8008', 'connect_address': f"{me['ip']}:8008"},
        'etcd': {'hosts': [f"{n['ip']}:2379" for n in nodes]},
        'bootstrap': {'dcs': {'ttl': 30, 'loop_wait': 10, 'retry_timeout': 10, 'maximum_lag_on_failover': 1048576, 'postgresql': {'use_pg_rewind': True, 'parameters': dcs_params, 'pg_hba': hba}},
                      # Patroni sets the superuser password from postgresql.authentication at initdb and creates the replication role after bootstrap.
                      'initdb': [{'encoding': 'UTF8'}, 'data-checksums', {'auth-local': 'peer'}, {'auth-host': 'scram-sha-256'}],
                      'post_bootstrap': '/opt/pgcloud/post-bootstrap.sh'},
        'postgresql': {'listen': '0.0.0.0:5432', 'connect_address': f"{me['ip']}:5432", 'data_dir': PG_DATA, 'bin_dir': PG_BIN, 'pgpass': '/var/lib/postgresql/.pgpass-patroni',
                       'authentication': {'superuser': {'username': 'postgres', 'password': pw}, 'replication': {'username': 'replicator', 'password': c['replicationPassword']}, 'rewind': {'username': 'postgres', 'password': pw}},
                       'parameters': params, 'pg_hba': hba},
        'tags': {'nofailover': False, 'noloadbalance': False, 'clonefrom': False},
    }
    import yaml
    changed = write('/etc/patroni/config.yml', yaml.safe_dump(patroni), 0o600, 'postgres:postgres')
    # Patroni passes a superuser connection string as the first argument.
    write('/opt/pgcloud/post-bootstrap.sh', "#!/bin/sh\nset -e\npsql \"$1\" -v ON_ERROR_STOP=1 -c \"CREATE ROLE %s WITH SUPERUSER LOGIN PASSWORD '%s'\"\n" % (c['admin']['user'], pw), 0o755)
    b = c.get('backup') or {}
    if b.get('bucket'):
        host, port = s3_host(b)
        write('/etc/pgbackrest/pgbackrest.conf', f"[main]\npg1-path={PG_DATA}\n[global]\nrepo1-type=s3\nrepo1-s3-endpoint={host}\n" + (f"repo1-storage-port={port}\n" if port else '') + f"repo1-s3-bucket={b['bucket']}\nrepo1-s3-region={b['region']}\nrepo1-s3-key={b['accessKey']}\nrepo1-s3-key-secret={b['secretKey']}\nrepo1-s3-uri-style=path\nrepo1-path=/{c['cluster']['name']}\nrepo1-retention-full=7\nprocess-max=2\nlog-level-console=info\n", 0o600, 'postgres:postgres')
    keepalived(c, me, '/usr/bin/curl -sf http://127.0.0.1:8008/primary')
    if sh('systemctl is-active --quiet patroni', check=False).returncode != 0:
        sh('systemctl enable patroni && systemctl start --no-block patroni', check=False)
    elif changed:
        sh('systemctl reload patroni', check=False)
    # pgbouncer in front, transaction pooling, auth through pg_shadow.
    ini = write('/etc/pgbouncer/pgbouncer.ini', f"[databases]\n* = host=127.0.0.1 port=5432\n[pgbouncer]\nlisten_addr = 0.0.0.0\nlisten_port = 6432\nauth_type = scram-sha-256\nauth_file = /etc/pgbouncer/userlist.txt\nauth_user = {c['admin']['user']}\nauth_query = SELECT usename, passwd FROM pg_shadow WHERE usename=$1\npool_mode = transaction\nmax_client_conn = 1000\ndefault_pool_size = 20\nclient_tls_sslmode = allow\nclient_tls_cert_file = /etc/pgcloud/server.crt\nclient_tls_key_file = /etc/pgcloud/server.key\n")
    users = write('/etc/pgbouncer/userlist.txt', f"\"{c['admin']['user']}\" \"{pw}\"\n", 0o600, 'postgres:postgres')
    if ini or users or sh('systemctl is-active --quiet pgbouncer', check=False).returncode:
        sh('systemctl enable pgbouncer && systemctl restart pgbouncer', check=False)
    # Users and databases are created on the primary once there is one; replicas get them by replication.
    for _ in range(45):
        if has_leader(): break
        time.sleep(2)
    else:
        raise NotReady('waiting for the cluster to elect a primary')
    if is_primary():
        admin = c['admin']['user']
        pg(f"DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='{admin}') THEN CREATE ROLE {admin} WITH SUPERUSER LOGIN; END IF; END $$;")
        pg(f"ALTER ROLE {admin} WITH SUPERUSER LOGIN PASSWORD '{pw}'")
        pg(f"ALTER ROLE postgres WITH PASSWORD '{pw}'")
        for u in c.get('users', []):
            pg(f"DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='{u['name']}') THEN CREATE ROLE {u['name']} LOGIN; END IF; END $$;")
            pg(f"ALTER ROLE {u['name']} WITH LOGIN PASSWORD '{u['password']}' CREATEDB")
        for d in c.get('databases', []):
            if pg(f"SELECT 1 FROM pg_database WHERE datname='{d}'").stdout.strip() != '1': pg(f"CREATE DATABASE {d}")
            for u in c.get('users', []): pg(f"GRANT ALL PRIVILEGES ON DATABASE {d} TO {u['name']}")
            pg('CREATE EXTENSION IF NOT EXISTS vector', d)
        archiving(c)
    missing = pg_missing(c)
    if missing: raise NotReady('waiting for ' + ', '.join(missing[:5]) + ' on this node')

def archiving(c):
    # WAL archiving starts only once the pgBackRest stanza exists; before that archive_command is /bin/true.
    if not (c.get('backup') or {}).get('bucket'): return
    if not os.path.exists('/var/lib/pgbackrest/.stanza'):
        r = sh('runuser -u postgres -- pgbackrest --stanza=main stanza-create', check=False)
        if r.returncode != 0:
            log('stanza-create failed: ' + (r.stderr or r.stdout)[-500:]); return
        os.makedirs('/var/lib/pgbackrest', exist_ok=True); open('/var/lib/pgbackrest/.stanza', 'w').write('ok')
    if pg('SHOW archive_command').stdout.strip() != ARCHIVE_CMD:
        req = urllib.request.Request('http://127.0.0.1:8008/config', data=json.dumps({'postgresql': {'parameters': {'archive_command': ARCHIVE_CMD}}}).encode(), method='PATCH', headers={'Content-Type': 'application/json'})
        urllib.request.urlopen(req, timeout=10).read()

def status_postgres():
    out = {'role': 'primary' if is_primary() else 'replica', 'members': [], 'lagBytes': None, 'dbSizes': {}, 'memberName': member_name()}
    cl = patroni_cluster()
    if cl:
        out['members'] = [{'name': m.get('name'), 'role': m.get('role'), 'state': m.get('state'), 'lag': m.get('lag')} for m in cl.get('members', [])]
        me = [m for m in cl.get('members', []) if m.get('name') == out['memberName']]
        if me and isinstance(me[0].get('lag'), int): out['lagBytes'] = me[0]['lag']
    r = pg('SELECT datname, pg_database_size(datname) FROM pg_database WHERE NOT datistemplate')
    for line in r.stdout.splitlines():
        if '|' in line:
            n, s = line.split('|'); out['dbSizes'][n] = int(s)
    out['diskUsedPercent'] = disk_used('/var/lib/postgresql')
    return out

def backup_postgres(bid):
    rec = {'id': bid, 'status': 'running', 'startedAt': time.time()}; record_backup(rec)
    r = sh('runuser -u postgres -- pgbackrest --stanza=main --type=full backup', check=False)
    rec['status'] = 'completed' if r.returncode == 0 else 'failed'; rec['completedAt'] = time.time(); rec['error'] = (r.stderr or '')[-500:] if r.returncode else None
    try:
        info = json.loads(sh('runuser -u postgres -- pgbackrest --stanza=main info --output=json', check=False).stdout)
        last = info[0]['backup'][-1]
        rec['sizeBytes'] = last['info']['repository']['size']
        if r.returncode == 0: rec['ref'] = last['label']
    except Exception: pass
    record_backup(rec)

def restore_postgres(req):
    c = last_config(); ref = req.get('ref')
    if not ref: raise RuntimeError('the backup has no pgBackRest label to restore')
    # Keep Patroni from failing over while this node is down, then hand the data directory to pgBackRest.
    sh(PATRONICTL + 'pause --wait', check=False)
    sh('systemctl stop patroni', check=False)
    pgctl = ['runuser', '-u', 'postgres', '--', PG_BIN + '/pg_ctl', '-D', PG_DATA]
    sh(pgctl + ['stop', '-m', 'fast', '-w'], check=False)
    r = sh(['runuser', '-u', 'postgres', '--', 'pgbackrest', '--stanza=main', '--delta', '--set=' + ref, '--type=immediate', '--target-action=promote', 'restore'], check=False)
    if r.returncode != 0:
        sh('systemctl start patroni', check=False); sh(PATRONICTL + 'resume', check=False)
        raise RuntimeError('pgbackrest restore: ' + (r.stderr or r.stdout)[-500:])
    # Replay to the end of the backup and promote outside Patroni, then give the node back to it.
    r = sh(pgctl + ['start', '-w', '-t', '3600', '-l', '/var/log/pgcloud-restore-postgres.log'], check=False)
    if r.returncode != 0: raise RuntimeError('the restored server did not start: ' + (r.stderr or r.stdout)[-500:])
    for _ in range(1800):
        if pg('SELECT pg_is_in_recovery()').stdout.strip() == 'f': break
        time.sleep(2)
    else:
        raise RuntimeError('the restored server did not finish recovery')
    sh(pgctl + ['stop', '-m', 'fast', '-w'], check=False)
    sh('systemctl start patroni', check=False)
    sh(PATRONICTL + 'resume --wait', check=False)
    for _ in range(90):
        if is_primary(): break
        time.sleep(2)
    else:
        raise RuntimeError('Patroni did not take the restored node back as primary')
    # The replicas are on the old timeline: rebuild them from the restored primary.
    for n in c['cluster']['nodes']:
        if not n['isSelf']: sh(PATRONICTL + 'reinit %s %s --force' % (c['cluster']['name'], n['name']), check=False)
    archiving(c)

# ---- valkey: replication plus sentinel on three nodes, ACL users, RDB backups ----
SENTINEL_DONE = '/opt/pgcloud/sentinel.configured'
def vcli(*args, host=None, port=6379):
    pw = open('/opt/pgcloud/admin.pw').read().strip()
    return sh(['valkey-cli'] + (['-h', host] if host else []) + ['-p', str(port)] + (['-a', pw, '--no-auth-warning'] if port == 6379 else []) + list(args), check=False)
def sentinel_primary():
    r = vcli('SENTINEL', 'get-master-addr-by-name', 'main', port=26379)
    parts = r.stdout.split()
    return parts[0] if r.returncode == 0 and parts else None

def apply_valkey(c):
    me = self_node(c); nodes = c['cluster']['nodes']; pw = c['admin']['password']
    first = min(nodes, key=lambda n: n['index'])
    # After the first configuration Sentinel owns the answer to "who is primary"; later pushes follow it.
    primary = (sentinel_primary() if os.path.exists(SENTINEL_DONE) else None) or first['ip']
    ensure_cert()
    conf = ["bind 0.0.0.0", "port 6379", "protected-mode yes", f"requirepass {pw}", f"masterauth {pw}", "appendonly yes", "dir /var/lib/valkey", "maxmemory-policy allkeys-lru",
            "tls-port 6380", "tls-cert-file /etc/pgcloud/server.crt", "tls-key-file /etc/pgcloud/server.key", "tls-auth-clients no", "tls-replication no", "aclfile /opt/pgcloud/acl.txt"]
    if primary != me['ip']: conf.append(f"replicaof {primary} 6379")
    conf_changed = render('/etc/valkey/valkey.conf', '\n'.join(conf) + '\n', 0o640, 'valkey:valkey')
    acl_changed = write('/opt/pgcloud/acl.txt', '\n'.join([f"user default on >{pw} ~* &* +@all"] + [f"user {u['name']} on >{u['password']} ~* &* +@all -@dangerous" for u in c.get('users', [])]) + '\n', 0o600, 'valkey:valkey')
    if conf_changed or sh('systemctl is-active --quiet valkey-server', check=False).returncode:
        sh('systemctl enable valkey-server && systemctl restart valkey-server', check=False)
    elif acl_changed:
        vcli('ACL', 'LOAD')
    if len(nodes) > 1:
        if not os.path.exists(SENTINEL_DONE):
            # Written once: Sentinel rewrites the file as the cluster fails over, and a later push must not reset it.
            write('/etc/valkey/sentinel.conf', f"port 26379\nbind 0.0.0.0\nsentinel monitor main {first['ip']} 6379 2\nsentinel auth-pass main {pw}\nsentinel down-after-milliseconds main 5000\nsentinel failover-timeout main 60000\nsentinel parallel-syncs main 1\n", 0o640, 'valkey:valkey')
            sh('systemctl enable valkey-sentinel && systemctl restart valkey-sentinel', check=False)
            open(SENTINEL_DONE, 'w').write('ok')
        else:
            vcli('SENTINEL', 'SET', 'main', 'auth-pass', pw, port=26379)
            sh('systemctl enable --now valkey-sentinel', check=False)
    keepalived(c, me, f"/usr/bin/valkey-cli -a {pw} --no-auth-warning role | head -1 | grep -q master")

def status_valkey():
    role = vcli('role').stdout.splitlines()
    out = {'role': 'primary' if role and role[0].strip() == 'master' else 'replica', 'members': [], 'lagBytes': None, 'dbSizes': {}}
    for line in vcli('info', 'replication').stdout.splitlines():
        if line.startswith('master_repl_offset:'): out['masterOffset'] = int(line.split(':')[1])
        if line.startswith('slave_repl_offset:'): out['lagBytes'] = max(0, out.get('masterOffset', 0) - int(line.split(':')[1]))
    for line in vcli('info', 'memory').stdout.splitlines():
        if line.startswith('used_memory:'): out['dbSizes']['default'] = int(line.split(':')[1])
    out['diskUsedPercent'] = disk_used('/var/lib/valkey')
    return out

def backup_valkey(bid):
    rec = {'id': bid, 'status': 'running', 'startedAt': time.time()}; record_backup(rec)
    try:
        cfg = last_config(); path = f'/var/lib/valkey/backup-{bid}.rdb'
        pw = open('/opt/pgcloud/admin.pw').read().strip()
        sh(['valkey-cli', '-a', pw, '--no-auth-warning', '--rdb', path])
        rec['sizeBytes'] = s3_put(cfg['backup'], f"{cfg['cluster']['name']}/{bid}.rdb", path); os.remove(path)
        rec['status'] = 'completed'; rec['ref'] = f"{cfg['cluster']['name']}/{bid}.rdb"
    except Exception as e:
        rec['status'] = 'failed'; rec['error'] = str(e)[-500:]
    rec['completedAt'] = time.time(); record_backup(rec)

def restore_valkey(req):
    c = last_config(); b = c['backup']; ips = [n['ip'] for n in c['cluster']['nodes']]
    def sentinels(ms):
        for ip in ips: vcli('SENTINEL', 'SET', 'main', 'down-after-milliseconds', str(ms), host=ip, port=26379)
    # Sentinels must not fail over while the primary is down for the load.
    if len(ips) > 1: sentinels(600000)
    try:
        tmp = '/var/lib/valkey/restore.rdb'
        s3_get(b, req.get('ref') or f"{c['cluster']['name']}/{req['backupId']}.rdb", tmp)
        sh('systemctl stop valkey-server', check=False)
        shutil.rmtree('/var/lib/valkey/appendonlydir', ignore_errors=True)
        os.replace(tmp, '/var/lib/valkey/dump.rdb'); sh(['chown', 'valkey:valkey', '/var/lib/valkey/dump.rdb'], check=False)
        # Load the RDB with AOF off, then turn AOF on so it is rebuilt from the restored data set.
        conf = open('/etc/valkey/valkey.conf').read()
        open('/etc/valkey/valkey.conf', 'w').write(conf.replace('appendonly yes', 'appendonly no'))
        sh('systemctl start valkey-server', check=False); time.sleep(2)
        for _ in range(900):
            if 'loading:0' in vcli('info', 'persistence').stdout: break
            time.sleep(1)
        else:
            raise RuntimeError('valkey did not finish loading the backup')
        vcli('config', 'set', 'appendonly', 'yes')
        open('/etc/valkey/valkey.conf', 'w').write(conf)
    finally:
        if len(ips) > 1: sentinels(5000)

# ---- mysql: GTID replication, agent driven failover, xtrabackup streamed to the bucket ----
def my(sql, host=None, c=None):
    # Local root, or a peer through the admin account (TLS is required by the server).
    if host: return sh(['mysql', '-h', host, '-u', c['admin']['user'], '-p' + c['admin']['password'], '--connect-timeout=3', '-N', '-e', sql], check=False)
    return sh(['mysql', '-uroot', '-p' + open('/opt/pgcloud/admin.pw').read().strip(), '-N', '-e', sql], check=False)
def replica_source():
    for line in my('SHOW REPLICA STATUS\\G').stdout.splitlines():
        if line.strip().startswith('Source_Host:'): return line.split(':', 1)[1].strip()
    return None
def point_to(c, ip):
    my(f"STOP REPLICA; CHANGE REPLICATION SOURCE TO SOURCE_HOST='{ip}', SOURCE_USER='replicator', SOURCE_PASSWORD='{c['replicationPassword']}', SOURCE_AUTO_POSITION=1, SOURCE_SSL=1, SOURCE_CONNECT_RETRY=10; START REPLICA;")
def gtid_count(text):
    # Number of transactions in a GTID set such as "uuid:1-5:7,uuid2:1-3".
    ranges = {}
    for part in text.replace('\\n', '').replace('\n', '').split(','):
        bits = part.strip().split(':')
        for rng in bits[1:]:
            if not rng[:1].isdigit(): continue
            a, _, z = rng.partition('-'); ranges.setdefault(bits[0], []).append((int(a), int(z or a)))
    total = 0
    for rs in ranges.values():
        merged = []
        for a, z in sorted(rs):
            if merged and a <= merged[-1][1] + 1: merged[-1] = (merged[-1][0], max(merged[-1][1], z))
            else: merged.append((a, z))
        total += sum(z - a + 1 for a, z in merged)
    return total
def gtid_position(host=None, c=None):
    # Executed plus received: a replica applies its relay log before it takes over.
    r = my("SELECT @@GLOBAL.gtid_executed, IFNULL((SELECT GROUP_CONCAT(RECEIVED_TRANSACTION_SET) FROM performance_schema.replication_connection_status), '')", host, c)
    if r.returncode != 0: return None
    return gtid_count(','.join(x for x in r.stdout.strip().split('\t') if x and x != 'NULL'))
def promote():
    received = my("SELECT IFNULL(GROUP_CONCAT(RECEIVED_TRANSACTION_SET), '') FROM performance_schema.replication_connection_status").stdout.strip().replace('\\n', '')
    my('STOP REPLICA IO_THREAD')
    if received: my(f"SELECT WAIT_FOR_EXECUTED_GTID_SET('{received}', 60)")
    my('STOP REPLICA; RESET REPLICA ALL; SET PERSIST super_read_only=0; SET PERSIST read_only=0')

def apply_mysql(c):
    me = self_node(c); nodes = c['cluster']['nodes']; pw = c['admin']['password']
    first = min(nodes, key=lambda n: n['index'])
    st = state()
    primary = st.get('mysqlPrimary') or first['ip']
    ensure_cert()
    conf = f"[mysqld]\nbind-address = 0.0.0.0\nserver-id = {me['index'] + 1}\ngtid_mode = ON\nenforce_gtid_consistency = ON\nlog_bin = binlog\nbinlog_expire_logs_seconds = 604800\nrelay_log = relay\nlog_replica_updates = ON\nrequire_secure_transport = ON\nssl_cert = /etc/pgcloud/server.crt\nssl_key = /etc/pgcloud/server.key\ninnodb_buffer_pool_size = {c.get('params', {}).get('innodb_buffer_pool_size', '256M')}\n"
    if write('/etc/mysql/mysql.conf.d/zz-pgcloud.cnf', conf) or sh('systemctl is-active --quiet mysql', check=False).returncode:
        sh('systemctl enable mysql && systemctl restart mysql', check=False)
    # root moves from socket authentication to the admin password, kept out of the binary log.
    if sh(['mysql', '-uroot', '-e', 'SELECT 1'], check=False).returncode == 0:
        sh(['mysql', '-uroot', '-e', f"SET sql_log_bin=0; ALTER USER 'root'@'localhost' IDENTIFIED BY '{pw}'"], check=False)
    first_time = not st.get('mysqlRole')
    if primary == me['ip']:
        if first_time: my('SET PERSIST super_read_only=0; SET PERSIST read_only=0')
        # Accounts are created on the primary only; replicas receive them by replication.
        admin = c['admin']['user']
        my(f"CREATE USER IF NOT EXISTS '{admin}'@'%' IDENTIFIED BY '{pw}'; ALTER USER '{admin}'@'%' IDENTIFIED BY '{pw}'; GRANT ALL ON *.* TO '{admin}'@'%' WITH GRANT OPTION;")
        my(f"CREATE USER IF NOT EXISTS 'replicator'@'%' IDENTIFIED BY '{c['replicationPassword']}'; ALTER USER 'replicator'@'%' IDENTIFIED BY '{c['replicationPassword']}'; GRANT REPLICATION SLAVE ON *.* TO 'replicator'@'%';")
        for u in c.get('users', []):
            my(f"CREATE USER IF NOT EXISTS '{u['name']}'@'%' IDENTIFIED BY '{u['password']}'; ALTER USER '{u['name']}'@'%' IDENTIFIED BY '{u['password']}';")
        for d in c.get('databases', []):
            my(f"CREATE DATABASE IF NOT EXISTS {BT}{d}{BT}")
            for u in c.get('users', []): my(f"GRANT ALL ON {BT}{d}{BT}.* TO '{u['name']}'@'%'")
    else:
        if first_time: my('SET PERSIST read_only=1; SET PERSIST super_read_only=1')
        if replica_source() != primary: point_to(c, primary)
        if my(f"SELECT COUNT(*) FROM mysql.user WHERE user='{c['admin']['user']}'").stdout.strip() in ('', '0'):
            update_state(mysqlPrimary=primary, mysqlRole='replica')
            raise NotReady('waiting for the accounts to replicate from the primary')
    update_state(mysqlPrimary=primary, mysqlRole='primary' if primary == me['ip'] else 'replica')
    keepalived(c, me, f"/usr/bin/mysql -uroot -p{pw} -N -e 'SELECT @@read_only' | grep -q 0")

def mysql_monitor():
    # Basic failover: after three missed checks of the primary, the replica with the most
    # advanced GTID set promotes itself and the others follow it. keepalived follows read_only.
    misses = 0
    while True:
        time.sleep(5)
        try:
            c = last_config(); st = state()
            if not c or len(c['cluster']['nodes']) < 2 or restoring() or not st.get('mysqlPrimary'): continue
            me = self_node(c); primary = st['mysqlPrimary']
            others = [n for n in c['cluster']['nodes'] if not n['isSelf']]
            if primary == me['ip']:
                # Back after an outage while another node took over: step down and follow it.
                if my('SELECT @@read_only').stdout.strip() != '0': continue
                for n in others:
                    if my('SELECT @@read_only', n['ip'], c).stdout.strip() == '0' and not my('SHOW REPLICA STATUS', n['ip'], c).stdout.strip():
                        log('another primary at %s; stepping down' % n['ip'])
                        my('SET PERSIST super_read_only=1'); point_to(c, n['ip']); update_state(mysqlPrimary=n['ip'], mysqlRole='replica')
                        break
                continue
            if my('SELECT 1', primary, c).returncode == 0:
                misses = 0; continue
            misses += 1
            if misses < 3: continue
            ranked = []
            for n in c['cluster']['nodes']:
                if n['ip'] == primary: continue
                pos = gtid_position() if n['isSelf'] else gtid_position(n['ip'], c)
                if pos is not None: ranked.append((pos, -n['index'], n))
            if not ranked: continue
            best = max(ranked, key=lambda x: (x[0], x[1]))[2]
            if best['isSelf']:
                log('primary %s unreachable; promoting this node' % primary)
                promote(); update_state(mysqlPrimary=me['ip'], mysqlRole='primary'); misses = 0
            elif my('SELECT @@read_only', best['ip'], c).stdout.strip() == '0':
                log('primary %s unreachable; following %s' % (primary, best['ip']))
                point_to(c, best['ip']); update_state(mysqlPrimary=best['ip']); misses = 0
        except Exception as e:
            log('monitor: ' + str(e)[-300:])

def status_mysql():
    ro = my('SELECT @@read_only').stdout.strip()
    out = {'role': 'primary' if ro == '0' else 'replica', 'members': [], 'lagBytes': None, 'dbSizes': {}}
    for line in my('SHOW REPLICA STATUS\\G').stdout.splitlines():
        if 'Seconds_Behind_Source' in line and line.split(':')[-1].strip().isdigit(): out['lagSeconds'] = int(line.split(':')[-1].strip())
    for line in my('SELECT table_schema, SUM(data_length+index_length) FROM information_schema.tables GROUP BY table_schema').stdout.splitlines():
        if '\t' in line:
            n, sz = line.split('\t'); out['dbSizes'][n] = int(sz) if sz.isdigit() else 0
    out['diskUsedPercent'] = disk_used('/var/lib/mysql')
    return out

def xbcloud_args(b):
    return f"--storage=s3 --s3-endpoint='{b['endpoint']}' --s3-access-key='{b['accessKey']}' --s3-secret-key='{b['secretKey']}' --s3-bucket='{b['bucket']}' --s3-region='{b['region']}' --parallel=2"

def backup_mysql(bid):
    rec = {'id': bid, 'status': 'running', 'startedAt': time.time()}; record_backup(rec)
    try:
        pw = open('/opt/pgcloud/admin.pw').read().strip(); cfg = last_config(); b = cfg['backup']; name = cfg['cluster']['name']
        r = sh(f"xtrabackup --backup --stream=xbstream --user=root --password='{pw}' 2>/var/log/pgcloud-xtrabackup.log | xbcloud put {xbcloud_args(b)} '{name}/{bid}'", check=False)
        if r.returncode != 0: raise RuntimeError((r.stderr or '')[-500:])
        rec['status'] = 'completed'; rec['ref'] = f'{name}/{bid}'
    except Exception as e:
        rec['status'] = 'failed'; rec['error'] = str(e)[-500:]
    rec['completedAt'] = time.time(); record_backup(rec)

def restore_mysql(req):
    c = last_config(); b = c['backup']; me = self_node(c)
    tmp = '/var/lib/pgcloud-restore'; old = '/var/lib/mysql.before-restore'; xlog = '/var/log/pgcloud-xtrabackup.log'
    shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    r = sh(f"xbcloud get {xbcloud_args(b)} '{req.get('ref') or c['cluster']['name'] + '/' + req['backupId']}' 2>>{xlog} | xbstream -x -C {tmp}", check=False)
    if r.returncode != 0: raise RuntimeError('download failed: ' + (r.stderr or '')[-400:])
    r = sh(f"xtrabackup --prepare --target-dir={tmp} >>{xlog} 2>&1", check=False)
    if r.returncode != 0: raise RuntimeError('xtrabackup --prepare failed; see ' + xlog)
    sh('systemctl stop mysql', check=False)
    shutil.rmtree(old, ignore_errors=True); os.rename('/var/lib/mysql', old); os.makedirs('/var/lib/mysql', mode=0o750)
    r = sh(f"xtrabackup --copy-back --target-dir={tmp} --datadir=/var/lib/mysql >>{xlog} 2>&1", check=False)
    if r.returncode != 0:
        shutil.rmtree('/var/lib/mysql', ignore_errors=True); os.rename(old, '/var/lib/mysql'); sh('systemctl start mysql', check=False)
        raise RuntimeError('xtrabackup --copy-back failed; the previous data directory is back in place')
    # Keep this node's server identity; persisted settings came from the node that took the backup.
    if os.path.exists(old + '/auto.cnf'): shutil.copy(old + '/auto.cnf', '/var/lib/mysql/auto.cnf')
    if os.path.exists('/var/lib/mysql/mysqld-auto.cnf'): os.remove('/var/lib/mysql/mysqld-auto.cnf')
    sh('chown -R mysql:mysql /var/lib/mysql', check=False)
    r = sh('systemctl start mysql', check=False)
    if r.returncode != 0: raise RuntimeError('mysql did not start on the restored data: ' + (r.stderr or '')[-300:])
    if req.get('primary'):
        my('STOP REPLICA; RESET REPLICA ALL; SET PERSIST super_read_only=0; SET PERSIST read_only=0')
        update_state(mysqlPrimary=me['ip'], mysqlRole='primary')
    else:
        # Restored from the same backup as the primary, so GTID auto positioning picks up from there.
        my('RESET REPLICA ALL; SET PERSIST read_only=1; SET PERSIST super_read_only=1')
        point_to(c, req['primaryIp']); update_state(mysqlPrimary=req['primaryIp'], mysqlRole='replica')
    shutil.rmtree(tmp, ignore_errors=True)

APPLY = {'postgres': apply_postgres, 'valkey': apply_valkey, 'mysql': apply_mysql}
STATUS = {'postgres': status_postgres, 'valkey': status_valkey, 'mysql': status_mysql}
BACKUP = {'postgres': backup_postgres, 'valkey': backup_valkey, 'mysql': backup_mysql}
RESTORE = {'postgres': restore_postgres, 'valkey': restore_valkey, 'mysql': restore_mysql}

def run_restore(req):
    rec = {'id': req['id'], 'backupId': req.get('backupId'), 'status': 'running', 'startedAt': time.time()}
    update_state(restore=rec)
    try:
        RESTORE[ENGINE](req); rec['status'] = 'completed'
    except Exception as e:
        rec['status'] = 'failed'; rec['error'] = str(e)[-800:]; log('restore failed: ' + rec['error'])
    rec['completedAt'] = time.time(); update_state(restore=rec)

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.headers.get('X-Pgcloud-Secret') != SECRET: return self._send(401, {'error': 'unauthorized'})
        if self.path != '/status': return self._send(404, {})
        st = state()
        try: engine = STATUS[ENGINE]()
        except Exception as e: engine = {'role': 'unknown', 'error': str(e)[-300:]}
        self._send(200, {'version': st.get('version', 0), 'engine': ENGINE, 'backups': st.get('backups', []), 'restore': st.get('restore'), **engine})
    def do_POST(self):
        if self.headers.get('X-Pgcloud-Secret') != SECRET: return self._send(401, {'error': 'unauthorized'})
        n = int(self.headers.get('Content-Length') or 0); body = json.loads(self.rfile.read(n) or b'{}')
        if self.path == '/config':
            if restoring(): return self._send(409, {'error': 'not_ready', 'detail': 'a restore is running'})
            with lock:
                try:
                    open('/opt/pgcloud/admin.pw', 'w').write(body['admin']['password']); os.chmod('/opt/pgcloud/admin.pw', 0o600)
                    json.dump(body, open(LAST, 'w')); os.chmod(LAST, 0o600)
                    APPLY[ENGINE](body)
                    update_state(version=body['version'])
                except NotReady as e:
                    return self._send(409, {'error': 'not_ready', 'detail': str(e)})
                except Exception as e:
                    log('apply failed: ' + str(e)[-800:])
                    return self._send(500, {'error': 'apply_failed', 'detail': str(e)[-800:]})
            return self._send(200, {'version': body['version']})
        if self.path == '/backup':
            if restoring(): return self._send(409, {'error': 'restore_running'})
            if STATUS[ENGINE]().get('role') != 'primary': return self._send(409, {'error': 'not_primary'})
            threading.Thread(target=BACKUP[ENGINE], args=(body['id'],), daemon=True).start()
            return self._send(202, {'id': body['id']})
        if self.path == '/restore':
            if restoring(): return self._send(409, {'error': 'restore_running'})
            threading.Thread(target=run_restore, args=(body,), daemon=True).start()
            return self._send(202, {'id': body['id']})
        self._send(404, {})
    def _send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

if ENGINE == 'mysql': threading.Thread(target=mysql_monitor, daemon=True).start()
http.server.ThreadingHTTPServer((bind_address(), 9009), H).serve_forever()`;

export function renderDbCloudInit(d: DbNodeInit): string {
  const agent = DBD_PY.replace('@@NET@@', AGENT_NET_PY).replace('@@S3@@', AGENT_S3_PY);
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
${indent(agent, 6)}
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
${RUNCMD[d.engine].map((c) => `  - ${yamlQuote(c)}`).join('\n')}
  - systemctl daemon-reload && systemctl enable --now pgcloud-dbd
`;
}

function indent(s: string, n: number) {
  return s.split('\n').map((l) => (l ? ' '.repeat(n) + l : '')).join('\n');
}

/** Single quoted YAML scalar, so shell text with colons and pipes stays one string. */
function yamlQuote(s: string) {
  return `'${s.replace(/'/g, "''")}'`;
}
