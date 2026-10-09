/**
 * The `prgd-appd` agent of a shared App Platform host, as Python source (standard library
 * only). cloud-init writes it to /opt/prgd/appd.py; `@@NET@@` is replaced by AGENT_NET_PY.
 *
 * Tenant isolation on the shared host:
 * - every app gets its own Docker network `prgd-app-<id>` (a /24 from APPS_RANGE). Caddy is
 *   attached to each app network and reaches the instances by container name; instances of
 *   different apps never share a network (Docker drops traffic between bridge networks);
 * - instances run with every capability dropped except a small list typical images need for
 *   user switching and file ownership (RUN_CAPS), no-new-privileges, a pids limit, an open
 *   files limit, rotated logs, and gVisor (runsc) when Docker has it;
 * - builds use the classic builder (it is the one that honours --memory and --cpu-quota) on the
 *   app's own network, with --pull and a 15 minute limit; a Dockerfile may not build FROM (or
 *   COPY --from) another app's image or a local image id;
 * - egress: iptables chains PRGD-EGRESS (DOCKER-USER) and PRGD-APPS-IN (INPUT) drop app traffic
 *   to private, CGNAT and link local ranges, to the host's own addresses and to tcp/25; the
 *   host's DNS resolvers, the app's own network (Caddy) and published ports stay reachable;
 * - the Git token never appears in a URL, a command line, .git/config or a log: git gets it as
 *   an http.extraHeader through GIT_CONFIG_* environment variables, and every logged line is
 *   redacted. .git never reaches the build context.
 *
 * One off containers (the pre-deploy command, console runs from POST /runs) use the instance
 * flags without the restart policy: same network, limits, capabilities, runtime and env file.
 * They get no TTY and a closed stdin, the command reaches `sh -c` in the container as one
 * argument (no shell on the host), they are killed at their timeout, and their output is
 * redacted (credentials in URLs, values of variables named like secrets) before it leaves the
 * host. They carry prgd.job or prgd.run labels so instance bookkeeping leaves them alone.
 *
 * Written with String.raw: backslashes are Python's own. Never put a dollar sign directly
 * followed by an opening brace in here (template interpolation).
 */
export const APPD_PY = String.raw`#!/usr/bin/env python3
# prgd app host agent. Standard library only. The control plane is the only writer of configuration.
import base64, http.server, ipaddress, json, os, re, shlex, shutil, subprocess, sys, threading, time, urllib.request, urllib.error
SECRET = open('/opt/prgd/vm.secret').read().strip() if os.path.exists('/opt/prgd/vm.secret') else ''
ROOT = '/var/lib/prgd/apps'
LAST = '/opt/prgd/last-config.json'
STATE = '/opt/prgd/state.json'
lock = threading.Lock()
net_lock = threading.Lock()
state_lock = threading.Lock()
runs_lock = threading.Lock()
# Builds share the host: at most two at a time, each with its own memory and CPU limit.
build_slots = threading.BoundedSemaphore(2)
state = {'version': 0, 'apps': {}, 'runs': {}}
building = set()
# The apps of the last config push by id (console runs need their env and limits).
apps_cfg = {}
# Console runs in progress: runId -> {'proc', 'canceled'}.
procs = {}
CADDY_IMAGE = 'caddy:2'
# App networks are /24s carved from this range; the egress rules match it as "app traffic".
APPS_RANGE = '172.20.0.0/14'
BUILD_TIMEOUT = 900
PREDEPLOY_TIMEOUT = 600
# Console runs: per app at once, output kept on disk (and for how long), output served.
MAX_RUNS_PER_APP = 2
RUN_LOG_BYTES = 1 << 20
RUN_KEEP = 86400
RUN_OUTPUT_BYTES = 65536
# After docker kill, how long the docker client may take to return before it is killed itself.
KILL_GRACE = 10
# Capabilities kept for app containers (everything else is dropped): file ownership and user
# switching in entrypoints (chown, gosu, su-exec), signalling child processes and binding ports
# below 1024. NET_RAW, MKNOD, SYS_CHROOT, SETPCAP, SETFCAP, AUDIT_WRITE and FSETID are gone.
RUN_CAPS = ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETUID', 'SETGID', 'KILL', 'NET_BIND_SERVICE']
BLOCKED_DESTS = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16']
APP_ID = re.compile(r'^[a-z0-9]{1,40}$')
RUN_ID = re.compile(r'^[a-z0-9]{1,40}$')

@@NET@@

# ---- logging without secrets ----
CRED_URL = re.compile(r'://[^/@\s]+:[^/@\s]+@')
def redact(text, secrets=()):
    if not text: return text
    for s in secrets:
        if s and len(s) >= 6: text = text.replace(s, '***')
    return CRED_URL.sub('://***@', text)

# Variables whose values are masked in the output of the pre-deploy command and console runs.
SECRET_NAME = re.compile(r'SECRET|TOKEN|PASSW|PASS$|PRIVATE|CREDENTIAL|API_?KEY|(^|_)KEY$|_DSN$|DATABASE_URL', re.I)
def env_secrets(env):
    return [str(v) for k, v in (env or {}).items() if SECRET_NAME.search(str(k)) and len(str(v)) >= 6]

def append_log(log, text):
    with open(log, 'a') as f: f.write(text)

def tail(path, n):
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2); size = f.tell(); f.seek(max(0, size - n)); return f.read().decode('utf-8', 'replace')
    except OSError: return ''

def sh(cmd, check=True, timeout=600, cwd=None, log=None, env=None, secrets=()):
    full_env = None
    if env:
        full_env = dict(os.environ); full_env.update(env)
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout, cwd=cwd, env=full_env)
    except subprocess.TimeoutExpired:
        if log is not None: append_log(log, '$ ' + redact(cmd[:200], secrets) + '\n' + 'timed out after %d seconds\n' % timeout)
        raise RuntimeError('timed out after %d seconds' % timeout)
    if log is not None:
        append_log(log, redact('$ ' + cmd[:200] + '\n' + r.stdout[-20000:] + r.stderr[-20000:], secrets))
    if check and r.returncode != 0: raise RuntimeError(redact((r.stderr.strip() or r.stdout.strip())[-600:], secrets))
    return r.stdout

def scrub_logs():
    # Build logs written before redaction existed may hold clone URLs with tokens.
    if not os.path.isdir(ROOT): return
    for aid in os.listdir(ROOT):
        p = ROOT + '/' + aid + '/build.log'
        try:
            if os.path.isfile(p) and not os.path.islink(p):
                text = open(p, encoding='utf-8', errors='replace').read()
                clean = redact(text)
                if clean != text: open(p, 'w').write(clean)
        except Exception: pass

def load_state():
    global state
    try: state = json.load(open(STATE))
    except Exception: pass
    state.setdefault('apps', {}); state.setdefault('runs', {})
def save_state():
    # Builds and runs save from their own threads: one writer at a time, replaced atomically.
    with state_lock:
        try: text = json.dumps(state)
        except RuntimeError: return  # changed while serialising; the next save writes it
        with open(STATE + '.tmp', 'w') as f: f.write(text)
        os.replace(STATE + '.tmp', STATE)

# ---- repository files: never follow a symlink out of the checkout ----
def regular(p): return os.path.isfile(p) and not os.path.islink(p)
def write_file(p, text):
    if os.path.lexists(p) and (os.path.islink(p) or not os.path.isfile(p)):
        if os.path.isdir(p) and not os.path.islink(p): shutil.rmtree(p)
        else: os.unlink(p)
    with open(p, 'w') as f: f.write(text)

def force_dockerignore(src):
    # .git (history, remote URL) never goes into the build context, whatever the repository says.
    p = src + '/.dockerignore'
    cur = open(p).read() if regular(p) else ''
    lines = [l.strip() for l in cur.splitlines() if l.strip()]
    if lines and lines[-1] in ('.git', '/.git'): return
    write_file(p, cur + ('' if not cur or cur.endswith('\n') else '\n') + '# added by the platform: the repository metadata stays out of the image\n.git\n')

def detect_dockerfile(d):
    if os.path.lexists(d + '/Dockerfile'):
        if not regular(d + '/Dockerfile'): raise RuntimeError('Dockerfile must be a regular file, not a symlink or directory')
        return None
    if regular(d + '/package.json'):
        pkg = json.load(open(d + '/package.json'))
        build = 'RUN npm run build\n' if (pkg.get('scripts') or {}).get('build') else ''
        lockcmd = 'npm ci' if os.path.exists(d + '/package-lock.json') else 'npm install'
        return 'FROM node:20-slim\nWORKDIR /app\nCOPY package*.json ./\nRUN ' + lockcmd + '\nCOPY . .\n' + build + 'ENV NODE_ENV=production\nCMD ["npm", "start"]\n'
    if os.path.exists(d + '/requirements.txt') or os.path.exists(d + '/pyproject.toml'):
        entry = 'gunicorn -b 0.0.0.0:$PORT app:app' if os.path.exists(d + '/app.py') else 'python main.py'
        req = 'RUN pip install --no-cache-dir -r requirements.txt gunicorn\n' if os.path.exists(d + '/requirements.txt') else 'RUN pip install --no-cache-dir . gunicorn\n'
        return 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\n' + req + 'ENV PYTHONUNBUFFERED=1\nCMD ' + entry + '\n'
    if os.path.exists(d + '/go.mod'):
        return 'FROM golang:1.23 AS build\nWORKDIR /src\nCOPY . .\nRUN CGO_ENABLED=0 go build -o /out/app .\nFROM gcr.io/distroless/static\nCOPY --from=build /out/app /app\nCMD ["/app"]\n'
    if os.path.exists(d + '/index.html'):
        return 'FROM nginx:alpine\nCOPY . /usr/share/nginx/html\nRUN sed -i "s/listen       80;/listen       $PORT;/" /etc/nginx/conf.d/default.conf || true\n'
    raise RuntimeError('no Dockerfile and no Node, Python, Go or static project detected at the repository root')

# ---- Dockerfile references: no building on another app's image ----
VAR = re.compile(r'\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?([-+])([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)')
def substitute(value, args):
    def rep(m):
        name = m.group(1) or m.group(4); op = m.group(2); word = m.group(3) or ''
        val = args.get(name)
        if op == '-': return val if val else substitute(word, args)
        if op == '+': return substitute(word, args) if val else ''
        return val or ''
    return VAR.sub(rep, value)

def logical_lines(text):
    escape = '\\'
    for raw in text.splitlines():
        m = re.match(r'^\s*#\s*escape\s*=\s*(\S)\s*$', raw)
        if m: escape = m.group(1); continue
        if not re.match(r'^\s*#\s*\w+\s*=', raw): break
    out, cur = [], ''
    for raw in text.splitlines():
        s = raw.strip()
        if not s or s.startswith('#'):
            continue
        if s.endswith(escape):
            cur += s[:-1] + ' '; continue
        out.append(cur + s); cur = ''
    if cur.strip(): out.append(cur)
    return out

def unquote(v):
    v = v.strip()
    return v[1:-1] if len(v) >= 2 and v[0] == v[-1] and v[0] in '"\'' else v

def dockerfile_refs(text, build_args=None):
    # Every image a Dockerfile pulls in: FROM, COPY/ADD --from and RUN --mount from=. ARG values
    # are substituted (build arguments win over defaults); stage names are left out.
    build_args = dict(build_args or {})
    args = dict(build_args); stages = set(); refs = []
    for line in logical_lines(text):
        parts = line.split(None, 1)
        instr = parts[0].upper(); rest = parts[1] if len(parts) > 1 else ''
        if instr == 'ARG':
            try: toks = shlex.split(rest, posix=True)
            except ValueError: toks = rest.split()
            for tok in toks:
                name, eq, val = tok.partition('=')
                if name in build_args: args[name] = build_args[name]
                elif eq: args[name] = substitute(unquote(val), args)
                else: args.setdefault(name, '')
        elif instr == 'FROM':
            toks = [t for t in rest.split() if not t.startswith('--')]
            if toks:
                ref = substitute(toks[0], args).strip()
                if ref.lower() not in stages: refs.append(ref)
                if len(toks) >= 3 and toks[1].lower() == 'as': stages.add(substitute(toks[2], args).lower())
        elif instr in ('COPY', 'ADD'):
            for m in re.finditer(r'--from=("[^"]*"|\'[^\']*\'|\S+)', rest):
                ref = substitute(unquote(m.group(1)), args).strip()
                if ref and not ref.isdigit() and ref.lower() not in stages: refs.append(ref)
        elif instr == 'RUN':
            for m in re.finditer(r'--mount=(\S+)', rest):
                for kv in m.group(1).split(','):
                    k, _, v = kv.partition('=')
                    if k == 'from':
                        ref = substitute(unquote(v), args).strip()
                        if ref and ref.lower() not in stages: refs.append(ref)
    return refs

def forbidden_ref(ref):
    r = ref.lower()
    name = r.split('@')[0]
    if 'prgd-app-' in r or name.rsplit('/', 1)[-1].startswith('prgd-'): return True
    if r.startswith('sha256:') or re.fullmatch(r'[0-9a-f]{12,64}', name): return True
    return False

def check_dockerfile(path, build_args):
    text = open(path, encoding='utf-8', errors='replace').read()
    for ref in dockerfile_refs(text, build_args):
        if forbidden_ref(ref):
            raise RuntimeError('the Dockerfile references %s: images built on this platform and local image ids cannot be used as a base or a source; use a public or registry image' % ref[:120])

# ---- per app networks ----
def app_net(aid): return 'prgd-app-' + aid

def used_subnets():
    names = sh("docker network ls -q", check=False).split()
    if not names: return []
    out = sh("docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' " + ' '.join(names), check=False).split()
    nets = []
    for s in out:
        try: nets.append(ipaddress.ip_network(s, strict=False))
        except ValueError: pass
    return nets

def free_subnet():
    used = [n for n in used_subnets() if n.version == 4]
    for cand in ipaddress.ip_network(APPS_RANGE).subnets(new_prefix=24):
        if not any(cand.overlaps(u) for u in used): return str(cand)
    raise RuntimeError('no free /24 left in %s for another app network' % APPS_RANGE)

def caddy_networks():
    return sh("docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' caddy 2>/dev/null", check=False).split()

def ensure_app_network(aid):
    net = app_net(aid)
    with net_lock:
        if subprocess.run(['docker', 'network', 'inspect', net], capture_output=True).returncode != 0:
            sh('docker network create --driver bridge --subnet %s --label prgd.app=%s %s' % (free_subnet(), aid, net))
        if net not in caddy_networks(): sh('docker network connect %s caddy' % net, check=False)
    return net

def connect_caddy_all():
    have = set(caddy_networks())
    for net in sh("docker network ls --filter label=prgd.app --format '{{.Name}}'", check=False).split():
        if net not in have: sh('docker network connect %s caddy' % net, check=False)

def remove_app(aid):
    net = app_net(aid)
    # Every container of the app goes, console runs and a pre-deploy job included.
    with runs_lock:
        for rid, r in state.get('runs', {}).items():
            if r.get('appId') == aid and r.get('status') == 'running':
                if rid in procs: procs[rid]['canceled'] = True
                else: r.update(status='canceled', finishedAt=time.time())
    sh("docker ps -aq --filter label=prgd.app=%s | xargs -r docker rm -f" % aid, check=False)
    imgs = set(sh("docker images -q --filter label=prgd.app=%s" % aid, check=False).split())
    imgs |= set(sh("docker images -q %s" % shlex.quote('prgd-app-' + aid), check=False).split())
    if imgs: sh('docker rmi -f ' + ' '.join(sorted(imgs)), check=False)
    sh('docker network disconnect -f %s caddy 2>/dev/null || true' % net, check=False)
    sh('docker network rm %s 2>/dev/null || true' % net, check=False)
    shutil.rmtree(ROOT + '/' + aid, ignore_errors=True)

def migrate_shared_network():
    # Hosts provisioned before per app networks ran every instance on "prgd" next to Caddy:
    # move each running instance onto its app's network without a restart.
    for line in sh("docker ps -a --filter label=prgd.app --format '{{.Names}} {{.Label \"prgd.app\"}} {{.Networks}}'", check=False).splitlines():
        p = line.split()
        if len(p) < 3 or not APP_ID.match(p[1]) or 'prgd' not in p[2].split(','): continue
        try:
            net = ensure_app_network(p[1])
            if net not in p[2].split(','): sh('docker network connect %s %s' % (net, p[0]), check=False)
            sh('docker network disconnect prgd %s' % p[0], check=False)
        except Exception as e:
            open('/var/log/prgd-agent.log', 'a').write('network migration of %s failed: %s\n' % (p[0], e))

# ---- runtime ----
def docker_info(fmt):
    return sh("docker info --format '%s' 2>/dev/null" % fmt, check=False)

def runtime_flags():
    want = open('/opt/prgd/runtime').read().strip() if os.path.exists('/opt/prgd/runtime') else 'auto'
    if want == 'runc': return []
    return ['--runtime', 'runsc'] if '"runsc"' in docker_info('{{json .Runtimes}}') else []

def userns_enabled():
    return 'userns' in docker_info('{{json .SecurityOptions}}')

def instances(aid, flags=''):
    # The app's instance containers: one off containers (pre-deploy, console runs) carry prgd.job or prgd.run.
    out = sh("docker ps %s --filter label=prgd.app=%s --format '{{.Names}}|{{.Label \"prgd.job\"}}{{.Label \"prgd.run\"}}'" % (flags, aid), check=False)
    return [l.split('|')[0] for l in out.split() if l.endswith('|')]

def run_flags(app):
    # The docker run options of one instance, minus name, env file and image.
    mem = int(app['memoryMb']); cpus = float(app['cpus'])
    f = ['--network', app_net(app['id']), '--restart', 'unless-stopped', '--memory', '%dm' % mem, '--cpus', ('%g' % cpus),
         '--pids-limit', '512', '--ulimit', 'nofile=8192:8192', '--cap-drop', 'ALL']
    for c in RUN_CAPS: f += ['--cap-add', c]
    f += ['--security-opt', 'no-new-privileges', '--log-driver', 'json-file', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3']
    return f + runtime_flags() + ['--label', 'prgd.app=' + app['id']]

def job_flags(app, label):
    # A one off container: the instance flags without the restart policy, marked with label.
    f = run_flags(app); i = f.index('--restart'); del f[i:i + 2]
    return f + ['--label', label]

def build_flags(app, image, dockerfile, src):
    # Classic builder: BuildKit ignores --memory and --cpu-quota. Steps run on the app's own
    # network, so the egress rules apply to them too.
    mem = min(max(int(app['memoryMb']) * 2, 1024), 4096); cpus = max(float(app['cpus']), 1.0)
    return ['docker', 'build', '--pull', '--rm', '--force-rm', '--network', app_net(app['id']), '--memory', '%dm' % mem, '--memory-swap', '%dm' % mem,
            '--cpu-period', '100000', '--cpu-quota', str(int(cpus * 100000)), '--ulimit', 'nofile=8192:8192',
            '--build-arg', 'PORT=%d' % int(app['port']), '--label', 'prgd.app=' + app['id'], '-t', image, '-f', dockerfile, src]

def git_env(token):
    # The token travels as an HTTP header in the environment of git only: not in the URL, the
    # command line, .git/config or the log.
    env = {'GIT_TERMINAL_PROMPT': '0'}
    if not token: return env, []
    basic = base64.b64encode(('x-access-token:' + token).encode()).decode()
    env.update({'GIT_CONFIG_COUNT': '1', 'GIT_CONFIG_KEY_0': 'http.extraHeader', 'GIT_CONFIG_VALUE_0': 'Authorization: Basic ' + basic})
    return env, [token, basic]

def build(app):
    aid = app['id']; d = ROOT + '/' + aid; src = d + '/src'; log = d + '/build.log'; secrets = []
    os.makedirs(d, exist_ok=True); open(log, 'w').write('=== build %s %s ===\n' % (aid, time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())))
    try:
        # Every customer supplied value is shell quoted: repo, branch and commit come from the API.
        env, secrets = git_env(app.get('token'))
        q = shlex.quote; repo_q = q(app['repo']); branch = q(app['branch'])
        if os.path.isdir(src + '/.git'):
            # Also replaces a token left in the remote URL by older agents.
            sh('git remote set-url origin %s' % repo_q, cwd=src, secrets=secrets)
            sh('git fetch --depth 1 origin %s && git reset --hard origin/%s' % (branch, branch), cwd=src, log=log, env=env, secrets=secrets)
        else:
            shutil.rmtree(src, ignore_errors=True)
            sh('git clone --depth 1 --branch %s %s %s' % (branch, repo_q, q(src)), log=log, env=env, secrets=secrets)
        if app.get('commit'): sh('git fetch --depth 1 origin %s && git checkout -q %s' % (q(app['commit']), q(app['commit'])), cwd=src, log=log, env=env, secrets=secrets, check=False)
        commit = sh('git rev-parse HEAD', cwd=src).strip()
        gen = detect_dockerfile(src)
        if gen: write_file(src + '/Dockerfile.prgd', gen)
        else: check_dockerfile(src + '/Dockerfile', {'PORT': str(int(app['port']))})
        force_dockerignore(src)
        image = 'prgd-app-%s:%s' % (aid, commit[:12])
        ensure_app_network(aid)
        with build_slots:
            sh('DOCKER_BUILDKIT=0 ' + ' '.join(shlex.quote(a) for a in build_flags(app, image, 'Dockerfile.prgd' if gen else 'Dockerfile', src)), cwd=src, log=log, timeout=BUILD_TIMEOUT, secrets=secrets)
        # Migrations and the like: the running version stays untouched when this fails.
        if app.get('preDeploy'): pre_deploy(app, image, log)
        run(app, image, log)
        state['apps'][aid] = {'deployId': app['deployId'], 'state': 'live', 'commit': commit, 'image': image, 'error': None}
        append_log(log, '=== live ===\n')
        # Older images of this app (not the one running) go.
        for old in sh("docker images %s --format '{{.Repository}}:{{.Tag}}'" % q('prgd-app-' + aid), check=False).split():
            if old != image: sh('docker rmi %s 2>/dev/null || true' % q(old), check=False)
    except Exception as e:
        err = redact(str(e), secrets)[-600:]
        prev = state['apps'].get(aid, {})
        # The image of the version still running stays: Caddy keeps serving it and console runs use it.
        state['apps'][aid] = {'deployId': app['deployId'], 'state': 'failed', 'commit': prev.get('commit'), 'image': prev.get('image'), 'error': err}
        append_log(log, '=== failed: %s ===\n' % err)
    finally:
        save_state(); building.discard(aid)

def env_text(app):
    return ''.join('%s=%s\n' % (k, str(v).replace('\n', '')) for k, v in (app.get('env') or {}).items()) + 'PORT=%d\n' % int(app['port'])

def write_env(app):
    # The env file of every container of the app (instances, pre-deploy, console runs); created 0600.
    d = ROOT + '/' + app['id']; os.makedirs(d, exist_ok=True); env = d + '/app.env'; tmp = env + '.tmp'
    if os.path.lexists(tmp): os.unlink(tmp)
    with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f: f.write(env_text(app))
    os.replace(tmp, env)
    return env

def kill_container(name, proc=None):
    try: subprocess.run(['docker', 'kill', name], capture_output=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired): pass
    # The docker client normally returns once the container is gone; if not, it goes too.
    if proc is not None:
        try: proc.wait(KILL_GRACE)
        except subprocess.TimeoutExpired: proc.kill()

def run_container(argv, name, timeout, out_path, cap=RUN_LOG_BYTES, job=None):
    # docker run attached, no TTY and stdin closed; combined output appended to out_path up to cap
    # bytes (the rest is read and dropped). Killed at the timeout. Returns (exit code, timed out).
    p = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if job is not None: job['proc'] = p
    expired = []
    def expire():
        expired.append(True); kill_container(name, p)
    timer = threading.Timer(timeout, expire); timer.daemon = True; timer.start()
    written = 0
    try:
        with open(out_path, 'ab') as f:
            while True:
                chunk = p.stdout.read1(65536)
                if not chunk: break
                if written < cap:
                    part = chunk[:cap - written]; f.write(part); f.flush(); written += len(part)
                    if written >= cap: f.write(b'\n[output truncated at %d bytes]\n' % cap)
        code = p.wait()
    finally:
        timer.cancel()
    return code, bool(expired)

def job_argv(app, name, label, env, image, command):
    return ['docker', 'run', '--rm', '--name', name] + job_flags(app, label) + ['--env-file', env, image, 'sh', '-c', command]

def pre_deploy(app, image, log):
    # Once per deploy, from the new image with the app's environment, network and limits, before
    # any instance is replaced. A non zero exit or the timeout fails the deploy.
    aid = app['id']; command = app['preDeploy']; name = 'prgd-%s-predeploy' % aid
    sec = env_secrets(app.get('env')); out = ROOT + '/' + aid + '/predeploy.out'
    env = write_env(app)
    subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
    if os.path.lexists(out): os.unlink(out)
    append_log(log, redact('=== pre-deploy: %s ===\n' % command, sec))
    try:
        code, timed_out = run_container(job_argv(app, name, 'prgd.job=predeploy', env, image, command), name, PREDEPLOY_TIMEOUT, out)
        text = redact(tail(out, RUN_OUTPUT_BYTES), sec)
    finally:
        if os.path.lexists(out): os.unlink(out)
    append_log(log, text + ('' if not text or text.endswith('\n') else '\n'))
    if timed_out:
        append_log(log, '=== pre-deploy timed out after %d seconds ===\n' % PREDEPLOY_TIMEOUT)
        raise RuntimeError('pre-deploy command failed (timed out after %d seconds)' % PREDEPLOY_TIMEOUT)
    append_log(log, '=== pre-deploy exited %d ===\n' % code)
    if code != 0: raise RuntimeError('pre-deploy command failed (exit %d)' % code)

def run(app, image, log):
    aid = app['id']; env = write_env(app)
    names = ['prgd-%s-%d' % (aid, i) for i in range(int(app['instances']))]
    flags = ' '.join(shlex.quote(f) for f in run_flags(app))
    # Start new instances beside the old ones, check health, then retire the old ones.
    for i, name in enumerate(names):
        sh('docker rm -f %s-next 2>/dev/null || true' % name, check=False)
        sh('docker run -d --name %s-next %s --env-file %s %s' % (name, flags, env, shlex.quote(image)), log=log)
        healthy(name + '-next', int(app['port']), app.get('healthPath'))
    for name in names:
        sh('docker rm -f %s 2>/dev/null || true' % name, check=False)
        sh('docker rename %s-next %s' % (name, name), check=False)
    for c in instances(aid, '-a'):
        if c not in names: sh('docker rm -f %s' % c, check=False)
    sh('docker image prune -f >/dev/null 2>&1', check=False)

def healthy(name, port, path):
    ip = sh("docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' %s" % name).split()
    ip = ip[0] if ip else ''
    deadline = time.time() + 120
    while time.time() < deadline:
        try:
            urllib.request.urlopen('http://%s:%d%s' % (ip, port, path or '/'), timeout=3).read(1); return
        except urllib.error.HTTPError:
            return  # the app answered, whatever the code
        except Exception:
            if 'running' not in sh("docker inspect -f '{{.State.Status}}' %s" % name, check=False): raise RuntimeError('instance exited during start; see the runtime log')
            time.sleep(2)
    raise RuntimeError('instance did not answer on port %d within two minutes' % port)

# ---- egress ----
def resolvers():
    out = []
    for f in ('/run/systemd/resolve/resolv.conf', '/etc/resolv.conf'):
        try:
            for line in open(f):
                p = line.split()
                if len(p) < 2 or p[0] != 'nameserver': continue
                try: ip = ipaddress.ip_address(p[1].split('%')[0])
                except ValueError: continue
                if ip.version == 4 and not ip.is_loopback and str(ip) not in out: out.append(str(ip))
        except OSError: pass
    return out

def host_addresses():
    toks = _out(['ip', '-4', '-o', 'addr', 'show', 'scope', 'global']).split()
    out = []
    for i, t in enumerate(toks):
        if t == 'inet' and i + 1 < len(toks):
            a = toks[i + 1].split('/')[0]
            if a not in out: out.append(a)
    return out

def egress_rules(dns, own):
    # PRGD-EGRESS, jumped to from DOCKER-USER for traffic from APPS_RANGE. RETURN lets Docker's
    # own chains decide (they keep app networks apart); DROP ends it.
    r = [['-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'RETURN'],
         # The app's own network (its instances and Caddy); Docker drops traffic between networks.
         ['-d', APPS_RANGE, '-j', 'RETURN']]
    for ip in dns:
        r += [['-d', ip, '-p', 'udp', '--dport', '53', '-j', 'RETURN'], ['-d', ip, '-p', 'tcp', '--dport', '53', '-j', 'RETURN']]
    # Published ports of this host (Caddy on 80/443) reached through its public address.
    r += [['-m', 'conntrack', '--ctstate', 'DNAT', '-j', 'RETURN'],
          ['-p', 'tcp', '--dport', '25', '-j', 'DROP']]
    r += [['-d', c, '-j', 'DROP'] for c in BLOCKED_DESTS]
    r += [['-d', a, '-j', 'DROP'] for a in own]
    return r

def ipt(*a):
    return subprocess.run(['iptables', '-w'] + list(a), capture_output=True, text=True)

def egress_installed():
    return ipt('-C', 'DOCKER-USER', '-s', APPS_RANGE, '-j', 'PRGD-EGRESS').returncode == 0 and ipt('-C', 'INPUT', '-s', APPS_RANGE, '-j', 'PRGD-APPS-IN').returncode == 0

def apply_egress():
    for chain in ('PRGD-EGRESS', 'PRGD-APPS-IN', 'DOCKER-USER'): ipt('-N', chain)
    ipt('-F', 'PRGD-EGRESS')
    for rule in egress_rules(resolvers(), host_addresses()): ipt('-A', 'PRGD-EGRESS', *rule)
    # Apps never talk to the host itself (agent, SSH): only replies to the host's own connections.
    ipt('-F', 'PRGD-APPS-IN')
    ipt('-A', 'PRGD-APPS-IN', '-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'RETURN')
    ipt('-A', 'PRGD-APPS-IN', '-j', 'DROP')
    if ipt('-C', 'DOCKER-USER', '-s', APPS_RANGE, '-j', 'PRGD-EGRESS').returncode != 0: ipt('-I', 'DOCKER-USER', '1', '-s', APPS_RANGE, '-j', 'PRGD-EGRESS')
    if ipt('-C', 'INPUT', '-s', APPS_RANGE, '-j', 'PRGD-APPS-IN').returncode != 0: ipt('-I', 'INPUT', '1', '-s', APPS_RANGE, '-j', 'PRGD-APPS-IN')

# ---- caddy ----
def ensure_caddy():
    # Caddy on the prgd network, ports 80 and 443 published, config and certificates on the host,
    # and attached to every app network.
    sh('docker network inspect prgd >/dev/null 2>&1 || docker network create prgd', check=False)
    if sh("docker inspect -f '{{.State.Running}}' caddy 2>/dev/null", check=False).strip() != 'true':
        sh('docker rm -f caddy 2>/dev/null || true', check=False)
        os.makedirs('/var/lib/caddy/data', exist_ok=True); os.makedirs('/var/lib/caddy/config', exist_ok=True)
        # With userns-remap Caddy keeps the host user namespace: it writes certificates to host directories.
        userns = '--userns=host ' if userns_enabled() else ''
        sh('docker run -d --name caddy --restart unless-stopped ' + userns + '--network prgd -p 80:80 -p 443:443 -p 443:443/udp -v /etc/caddy:/etc/caddy -v /var/lib/caddy/data:/data -v /var/lib/caddy/config:/config ' + CADDY_IMAGE)
    connect_caddy_all()

def caddy(apps):
    out = ['{', '  email ' + open('/opt/prgd/acme.email').read().strip() if os.path.exists('/opt/prgd/acme.email') else '', '}', ':80 {', '  respond "prgd app platform" 200', '}']
    for app in apps:
        st = state['apps'].get(app['id']) or {}
        # Served while a version runs: live, or a redeploy building or failed over a live image.
        if not (st.get('state') == 'live' or st.get('image')) or app.get('stopped'): continue
        ups = ' '.join('prgd-%s-%d:%d' % (app['id'], i, int(app['port'])) for i in range(int(app['instances'])))
        out.append('%s {\n  encode zstd gzip\n  reverse_proxy %s {\n    lb_policy round_robin\n    health_uri %s\n    health_interval 10s\n  }\n}' % (', '.join(app['hostnames']), ups, app.get('healthPath') or '/'))
    open('/etc/caddy/Caddyfile', 'w').write('\n'.join(out) + '\n')
    ensure_caddy()
    sh('docker exec caddy caddy reload --config /etc/caddy/Caddyfile', check=False)

def apply(c):
    if not egress_installed(): apply_egress()
    ensure_caddy()
    apps = []
    for a in c['apps']:
        if APP_ID.match(str(a.get('id', ''))): apps.append(a)
        else: open('/var/log/prgd-agent.log', 'a').write('ignoring app with an invalid id %r\n' % (a.get('id'),))
    wanted = {a['id'] for a in apps}
    apps_cfg.clear(); apps_cfg.update({a['id']: a for a in apps})
    for aid in list(state['apps']):
        if aid not in wanted:
            if APP_ID.match(aid): remove_app(aid)
            state['apps'].pop(aid, None)
    for app in apps:
        st = state['apps'].get(app['id']) or {}
        if app.get('stopped'):
            for n in instances(app['id']): sh('docker stop %s' % n, check=False)
            continue
        if st.get('deployId') != app['deployId'] and app['id'] not in building:
            ensure_app_network(app['id'])
            building.add(app['id']); state['apps'][app['id']] = {**st, 'deployId': app['deployId'], 'state': 'building', 'error': None}
            threading.Thread(target=build, args=(app,), daemon=True).start()
        elif st.get('state') == 'live':
            for n in instances(app['id'], '-a --filter status=exited'): sh('docker start %s' % n, check=False)
    save_state(); caddy(apps)

# ---- console runs ----
def run_log(aid, rid): return ROOT + '/' + aid + '/runs/' + rid + '.log'

def prune_runs():
    # Finished runs are forgotten, with their output, after a day. Called with runs_lock held.
    now = time.time()
    for rid, r in list(state['runs'].items()):
        if r.get('status') != 'running' and now - (r.get('finishedAt') or r.get('startedAt') or 0) > RUN_KEEP:
            state['runs'].pop(rid, None)
            if APP_ID.match(str(r.get('appId', ''))) and os.path.lexists(run_log(r['appId'], rid)): os.unlink(run_log(r['appId'], rid))

def recover_runs():
    # Runs whose agent restarted: the attached docker client is gone, so the result is too.
    for rid, r in state['runs'].items():
        if r.get('status') == 'running':
            subprocess.run(['docker', 'rm', '-f', 'prgd-run-' + rid], capture_output=True)
            r.update(status='failed', finishedAt=time.time())
            if APP_ID.match(str(r.get('appId', ''))) and os.path.isdir(ROOT + '/' + r['appId'] + '/runs'): append_log(run_log(r['appId'], rid), '\n[the host agent restarted; the command was stopped]\n')

def start_run(body):
    rid = str(body.get('runId', '')); aid = str(body.get('appId', '')); command = body.get('command')
    if not RUN_ID.match(rid) or not APP_ID.match(aid): return 400, {'error': 'bad_id'}
    if not isinstance(command, str) or not command or len(command) > 2000 or '\0' in command: return 400, {'error': 'bad_command'}
    try: timeout = int(600 if body.get('timeout') is None else body['timeout'])
    except (TypeError, ValueError): return 400, {'error': 'bad_timeout'}
    if timeout < 1 or timeout > 3600: return 400, {'error': 'bad_timeout'}
    app = apps_cfg.get(aid); image = (state['apps'].get(aid) or {}).get('image')
    if not app: return 404, {'error': 'unknown_app'}
    if not image: return 409, {'error': 'no_image', 'detail': 'the app has no live image on this host'}
    with runs_lock:
        prune_runs()
        if rid in state['runs']: return 409, {'error': 'duplicate_run'}
        if sum(1 for r in state['runs'].values() if r.get('appId') == aid and r.get('status') == 'running') >= MAX_RUNS_PER_APP: return 409, {'error': 'run_limit'}
        state['runs'][rid] = {'appId': aid, 'status': 'running', 'exitCode': None, 'startedAt': time.time(), 'finishedAt': None}
        procs[rid] = {'canceled': False}
    save_state()
    threading.Thread(target=run_job, args=(app, rid, command, timeout, image), daemon=True).start()
    return 202, {'runId': rid, 'status': 'running'}

def run_job(app, rid, command, timeout, image):
    aid = app['id']; job = procs.get(rid) or {'canceled': False}; log = run_log(aid, rid)
    code, timed_out = None, False
    try:
        os.makedirs(ROOT + '/' + aid + '/runs', exist_ok=True)
        env = ROOT + '/' + aid + '/app.env'
        if not os.path.exists(env): env = write_env(app)
        name = 'prgd-run-' + rid
        code, timed_out = run_container(job_argv(app, name, 'prgd.run=' + rid, env, image, command), name, timeout, log, RUN_LOG_BYTES, job)
    except Exception as e:
        try: append_log(log, '\n[the command could not start: %s]\n' % e)
        except OSError: pass
    with runs_lock:
        r = state['runs'].get(rid)
        if r is not None and r.get('status') == 'running':
            r.update(exitCode=code, finishedAt=time.time(), status=run_status(code, timed_out, job.get('canceled')))
        procs.pop(rid, None)
    save_state()

def run_status(code, timed_out, canceled):
    if canceled: return 'canceled'
    if timed_out: return 'timed_out'
    return 'succeeded' if code == 0 else 'failed'

def run_report(rid):
    r = state['runs'].get(rid)
    if not r: return None
    app = apps_cfg.get(r.get('appId')) or {}
    out = tail(run_log(r['appId'], rid), RUN_OUTPUT_BYTES) if APP_ID.match(str(r.get('appId', ''))) else ''
    return {'appId': r.get('appId'), 'status': r.get('status'), 'exitCode': r.get('exitCode'), 'startedAt': r.get('startedAt'), 'finishedAt': r.get('finishedAt'), 'output': redact(out, env_secrets(app.get('env')))}

def cancel_run(rid):
    with runs_lock:
        r = state['runs'].get(rid)
        if not r: return 404, {'error': 'unknown_run'}
        if r.get('status') != 'running': return 200, {'status': r.get('status')}
        job = procs.get(rid)
        if job is not None: job['canceled'] = True
        else: r.update(status='canceled', finishedAt=time.time())
    kill_container('prgd-run-' + rid)
    save_state()
    return 202, {'status': 'canceled'}

def status():
    out = {'version': state.get('version', 0), 'apps': {}}
    with runs_lock:
        prune_runs()
        # Results nobody polled reach the control plane through here.
        out['runs'] = {rid: {'appId': r.get('appId'), 'status': r.get('status'), 'exitCode': r.get('exitCode')} for rid, r in state['runs'].items()}
    for aid, st in state['apps'].items():
        running = len(instances(aid))
        tail = ''
        try:
            with open(ROOT + '/' + aid + '/build.log', 'rb') as f:
                f.seek(0, 2); n = f.tell(); f.seek(max(0, n - 4096)); tail = redact(f.read().decode('utf-8', 'replace'))
        except Exception: pass
        out['apps'][aid] = {**st, 'running': running, 'logTail': tail}
    mem = sh("docker stats --no-stream --format '{{.MemUsage}}'", check=False)
    out['memUsed'] = mem.count('\n')
    # The control plane places apps only on hosts where both are up.
    out['docker'] = subprocess.run(['docker', 'info'], capture_output=True).returncode == 0
    out['caddy'] = sh("docker inspect -f '{{.State.Running}}' caddy 2>/dev/null", check=False).strip() == 'true'
    out['ready'] = out['docker'] and out['caddy']
    return out

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if not secret_ok(self.headers.get('X-Prgd-Secret')): return self._send(401, {'error': 'unauthorized'})
        if self.path == '/status': return self._send(200, status())
        if self.path.startswith('/runs/'):
            rid = self.path[len('/runs/'):]
            if not RUN_ID.match(rid): return self._send(400, {'error': 'bad_run'})
            rep = run_report(rid)
            return self._send(200, rep) if rep else self._send(404, {'error': 'unknown_run'})
        if self.path.startswith('/logs'):
            q = dict(p.split('=', 1) for p in self.path.split('?', 1)[1].split('&') if '=' in p) if '?' in self.path else {}
            aid = q.get('app', ''); kind = q.get('type', 'build')
            if not aid.isalnum(): return self._send(400, {'error': 'bad_app'})
            if kind == 'runtime':
                # Every instance, each under its own heading.
                names = sorted(instances(aid, '-a'))
                log = ''.join('=== %s ===\n%s' % (n, sh('docker logs --tail 300 --timestamps %s 2>&1' % n, check=False)) for n in names if not n.endswith('-next'))
            else:
                try:
                    with open(ROOT + '/' + aid + '/build.log', 'rb') as f:
                        f.seek(0, 2); n = f.tell(); f.seek(max(0, n - 65536)); log = redact(f.read().decode('utf-8', 'replace'))
                except Exception: log = ''
            return self._send(200, {'log': log})
        self._send(404, {})
    def do_POST(self):
        if not secret_ok(self.headers.get('X-Prgd-Secret')): return self._send(401, {'error': 'unauthorized'})
        n = int(self.headers.get('Content-Length') or 0); body = json.loads(self.rfile.read(n) or b'{}')
        if not isinstance(body, dict): return self._send(400, {'error': 'bad_body'})
        if self.path == '/runs': return self._send(*start_run(body))
        m = re.match(r'^/runs/([a-z0-9]{1,40})/cancel$', self.path)
        if m: return self._send(*cancel_run(m.group(1)))
        if self.path == '/config':
            with lock:
                try:
                    json.dump(body, open(LAST, 'w')); os.chmod(LAST, 0o600)
                    apply(body); state['version'] = body['version']; save_state()
                except Exception as e:
                    return self._send(500, {'error': 'apply_failed', 'detail': redact(str(e))[-800:]})
            return self._send(200, {'version': body['version']})
        self._send(404, {})
    def _send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

def main():
    if '--egress-only' in sys.argv:
        apply_egress(); return
    load_state()
    try: apps_cfg.update({a['id']: a for a in json.load(open(LAST)).get('apps', []) if APP_ID.match(str(a.get('id', '')))})
    except Exception: pass
    recover_runs(); save_state()
    try: apply_egress()
    except Exception as e: open('/var/log/prgd-agent.log', 'a').write('egress rules failed: %s\n' % e)
    try: ensure_caddy()
    except Exception: pass
    with lock:
        try: migrate_shared_network()
        except Exception: pass
    scrub_logs()
    http.server.ThreadingHTTPServer((bind_address(), 9009), H).serve_forever()

if __name__ == '__main__':
    main()
`;
