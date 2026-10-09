import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appdSource, appHostDaemonJson, renderAppHostCloudInit } from './cloud-init';

const hasPython = spawnSync('python3', ['--version']).status === 0;

/** Runs a Python snippet against the rendered agent, imported as module `m`. */
function py(snippet: string) {
  const dir = mkdtempSync(join(tmpdir(), 'appd-'));
  writeFileSync(join(dir, 'appd.py'), appdSource());
  const prelude = `import importlib.util, sys\nspec = importlib.util.spec_from_file_location('appd', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n`;
  writeFileSync(join(dir, 't.py'), prelude + snippet);
  const r = spawnSync('python3', ['-I', join(dir, 't.py'), join(dir, 'appd.py')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
}

describe('app host cloud-init', () => {
  const runc = renderAppHostCloudInit({ vmSecret: 's3cret', acmeEmail: 'ops@example.com', runtime: 'runc', userns: true });
  const runsc = renderAppHostCloudInit({ vmSecret: 's3cret', acmeEmail: 'ops@example.com', runtime: 'runsc', userns: false });

  it('writes daemon.json with userns-remap and address pools outside the app range', () => {
    expect(JSON.parse(appHostDaemonJson({ userns: true }))).toMatchObject({ 'userns-remap': 'default', 'default-address-pools': [{ base: '172.24.0.0/14', size: 24 }] });
    expect(JSON.parse(appHostDaemonJson({ userns: false }))['userns-remap']).toBeUndefined();
    expect(runc).toContain('path: /etc/docker/daemon.json');
    expect(runc).toContain('"userns-remap": "default"');
    expect(runsc).not.toContain('"userns-remap": "default"');
    // Caddy writes certificates to host directories, so it keeps the host user namespace.
    expect(runc).toContain('--restart unless-stopped --userns=host --network prgd');
  });

  it('installs gVisor only for runsc', () => {
    expect(runc).not.toContain('install-gvisor');
    expect(runc).toContain("content: 'runc'");
    expect(runsc).toContain('https://storage.googleapis.com/gvisor/releases release main');
    expect(runsc).toContain('  - /opt/prgd/install-gvisor.sh');
    expect(runsc).toContain('runsc install');
  });

  it('applies the egress rules before the agent starts', () => {
    expect(runc).toContain('python3 /opt/prgd/appd.py --egress-only');
  });

  it('runs every app on its own network with restricted containers', () => {
    const src = appdSource();
    expect(src).not.toContain('--network prgd --restart');
    expect(src).not.toContain('x-access-token:%s@');
    expect(src).toContain("'--cap-drop', 'ALL'");
    expect(src).toContain("'--security-opt', 'no-new-privileges'");
    expect(src).toContain("'--pids-limit', '512'");
    expect(src).toContain('BUILD_TIMEOUT = 900');
    expect(src).toContain('PREDEPLOY_TIMEOUT = 600');
    // One off containers never go through a shell on the host.
    expect(src).toContain("'sh', '-c', command]");
    expect(src).toContain("DOCKER_BUILDKIT=0");
    expect(src).toContain('secret_ok(self.headers.get(');
    expect(src).not.toContain("!= SECRET");
    // The shared network helpers are pasted in, and the agent never listens on every address.
    expect(src).not.toContain('@@NET@@');
    expect(src).not.toContain("return '0.0.0.0'");
  });

  it.skipIf(!hasPython)('compiles', () => {
    const dir = mkdtempSync(join(tmpdir(), 'appd-'));
    writeFileSync(join(dir, 'appd.py'), appdSource());
    const r = spawnSync('python3', ['-m', 'py_compile', join(dir, 'appd.py')], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it.skipIf(!hasPython)('redacts tokens and credentials in URLs', () => {
    const out = py(`import base64
tok = 'ghs_abcdefSECRET123'
env, secrets = m.git_env(tok)
basic = base64.b64encode(('x-access-token:' + tok).encode()).decode()
assert env['GIT_CONFIG_KEY_0'] == 'http.extraHeader' and env['GIT_CONFIG_VALUE_0'] == 'Authorization: Basic ' + basic
s = m.redact('https://x-access-token:%s@github.com/a/b %s %s' % (tok, basic, tok), secrets)
assert tok not in s and basic not in s and 'x-access-token' not in s, s
assert m.redact('https://u:p@h/x') == 'https://***@h/x'
assert m.redact('https://github.com/a/b') == 'https://github.com/a/b'
print('ok')`);
    expect(out).toBe('ok');
  });

  it.skipIf(!hasPython)('rejects Dockerfiles built on another app or a local image id', () => {
    const out = py(`F = m.dockerfile_refs
assert F('ARG BASE=prgd-app-abc:1\\nFROM $BASE') == ['prgd-app-abc:1']
assert F('ARG V\\nFROM prgd-app-\${V:-x}:1') == ['prgd-app-x:1']
assert F('FROM golang AS build\\nFROM build\\nCOPY --from=build /a /b\\nCOPY --from=prgd-app-z:1 /a /b') == ['golang', 'prgd-app-z:1']
assert F('FROM --platform=linux/amd64 \\\\\\n  prgd-app-q:1 AS x') == ['prgd-app-q:1']
assert F('FROM alpine\\nRUN --mount=type=bind,from=prgd-app-m:1,target=/x true') == ['alpine', 'prgd-app-m:1']
assert F('ARG B=alpine\\nFROM \${B}', {'B': 'prgd-app-k:1'}) == ['prgd-app-k:1']
for bad in ['prgd-app-x:1', 'docker.io/library/prgd-app-x', 'sha256:' + 'a' * 64, 'abcdef123456']: assert m.forbidden_ref(bad), bad
for good in ['node:20-slim', 'gcr.io/distroless/static', 'python:3.12@sha256:' + 'b' * 64, 'scratch']: assert not m.forbidden_ref(good), good
print('ok')`);
    expect(out).toBe('ok');
  });

  it.skipIf(!hasPython)('builds run and build flags', () => {
    const out = py(`m.runtime_flags = lambda: []
app = {'id': 'abc123', 'memoryMb': 512, 'cpus': 0.5, 'port': 3000}
r = ' '.join(m.run_flags(app))
for w in ['--network prgd-app-abc123', '--cap-drop ALL', '--cap-add NET_BIND_SERVICE', '--security-opt no-new-privileges', '--pids-limit 512', '--ulimit nofile=8192:8192', '--log-opt max-size=10m', '--log-opt max-file=3', '--memory 512m', '--cpus 0.5']: assert w in r, w
assert 'NET_RAW' not in r
m.runtime_flags = lambda: ['--runtime', 'runsc']
assert '--runtime runsc' in ' '.join(m.run_flags(app))
b = ' '.join(m.build_flags(app, 'prgd-app-abc123:1', 'Dockerfile', '/src'))
for w in ['--pull', '--memory 1024m', '--cpu-quota 100000', '--network prgd-app-abc123', '--label prgd.app=abc123']: assert w in b, w
e = [' '.join(x) for x in m.egress_rules(['10.96.0.1'], ['203.0.113.7'])]
assert e[0] == '-m conntrack --ctstate ESTABLISHED,RELATED -j RETURN'
assert e.index('-d 10.96.0.1 -p udp --dport 53 -j RETURN') < e.index('-d 10.0.0.0/8 -j DROP')
for c in ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16', '203.0.113.7']: assert '-d %s -j DROP' % c in e, c
assert '-p tcp --dport 25 -j DROP' in e
print('ok')`);
    expect(out).toBe('ok');
  });

  it.skipIf(!hasPython)('runs the pre-deploy command in a one off container and fails the deploy on a non zero exit', () => {
    const out = py(`import os, tempfile
m.runtime_flags = lambda: []
m.ROOT = tempfile.mkdtemp()
seen = []
def fake(argv, name, timeout, out_path, cap=m.RUN_LOG_BYTES, job=None):
    seen.append((argv, name, timeout))
    open(out_path, 'ab').write(b'Applying migration 0001\\npostgresql://app:hunter2secret@db:5432/x token=s3cr3tvalue\\n')
    return code[0], False
m.run_container = fake
m.subprocess.run = lambda *a, **k: None
app = {'id': 'abc123', 'memoryMb': 512, 'cpus': 0.5, 'port': 3000, 'instances': 1, 'preDeploy': 'npx prisma migrate deploy', 'env': {'API_TOKEN': 's3cr3tvalue', 'NODE_ENV': 'production'}}
log = m.ROOT + '/build.log'; open(log, 'w').close()
code = [0]
m.pre_deploy(app, 'prgd-app-abc123:1', log)
argv, name, timeout = seen[0]
a = ' '.join(argv)
assert name == 'prgd-abc123-predeploy' and timeout == 600
assert argv[:5] == ['docker', 'run', '--rm', '--name', 'prgd-abc123-predeploy'], argv
assert argv[-4:] == ['prgd-app-abc123:1', 'sh', '-c', 'npx prisma migrate deploy'], argv
assert '--restart' not in argv
for w in ['--network prgd-app-abc123', '--cap-drop ALL', '--security-opt no-new-privileges', '--pids-limit 512', '--memory 512m', '--label prgd.app=abc123', '--label prgd.job=predeploy', '--env-file ' + m.ROOT + '/abc123/app.env']: assert w in a, w
envf = m.ROOT + '/abc123/app.env'
assert oct(os.stat(envf).st_mode & 0o777) == '0o600'
assert open(envf).read() == 'API_TOKEN=s3cr3tvalue\\nNODE_ENV=production\\nPORT=3000\\n'
text = open(log).read()
assert '=== pre-deploy: npx prisma migrate deploy ===' in text and '=== pre-deploy exited 0 ===' in text, text
assert 'hunter2secret' not in text and 's3cr3tvalue' not in text and 'Applying migration 0001' in text, text
code[0] = 3
try:
    m.pre_deploy(app, 'prgd-app-abc123:1', log); raise SystemExit('no failure')
except RuntimeError as e:
    assert str(e) == 'pre-deploy command failed (exit 3)', e
assert '=== pre-deploy exited 3 ===' in open(log).read()
print('ok')`);
    expect(out).toBe('ok');
  });

  it.skipIf(!hasPython)('captures, caps and times out one off containers', () => {
    const out = py(`import tempfile, time
m.KILL_GRACE = 0.2
d = tempfile.mkdtemp()
code, timed_out = m.run_container(['sh', '-c', 'echo hello; echo oops >&2; exit 3'], 'x', 30, d + '/a.log')
assert (code, timed_out) == (3, False) and open(d + '/a.log').read() == 'hello\\noops\\n'
code, timed_out = m.run_container(['sh', '-c', 'head -c 5000 /dev/zero | tr "\\\\0" a'], 'x', 30, d + '/b.log', cap=1000)
assert code == 0 and open(d + '/b.log').read().startswith('a' * 1000 + '\\n[output truncated')
t = time.time()
code, timed_out = m.run_container(['sleep', '20'], 'prgd-run-none', 0.5, d + '/c.log')
assert timed_out and time.time() - t < 10, (code, timed_out)
assert m.run_status(0, False, False) == 'succeeded' and m.run_status(3, False, False) == 'failed'
assert m.run_status(137, True, False) == 'timed_out' and m.run_status(137, False, True) == 'canceled'
print('ok')`);
    expect(out).toBe('ok');
  });

  it.skipIf(!hasPython)('starts console runs only for apps with a live image, two at a time', () => {
    const out = py(`import tempfile
m.STATE = tempfile.mkdtemp() + '/state.json'
started = []
m.run_job = lambda *a: started.append(a)
m.threading.Thread = lambda target, args, daemon: type('T', (), {'start': lambda self: target(*args)})()
m.apps_cfg['abc123'] = {'id': 'abc123', 'env': {'DATABASE_URL': 'postgresql://u:pw@h/db', 'SESSION_SECRET': 'verysecret1'}}
ok = {'runId': 'run1', 'appId': 'abc123', 'command': 'npx prisma db seed', 'timeout': 60}
assert m.start_run({**ok, 'runId': 'Bad-Id'})[0] == 400
assert m.start_run({**ok, 'appId': '../x'})[0] == 400
assert m.start_run({**ok, 'command': ''})[0] == 400
assert m.start_run({**ok, 'command': 'x' * 2001})[0] == 400
assert m.start_run({**ok, 'timeout': 0})[0] == 400
assert m.start_run({**ok, 'appId': 'other'})[0] == 404
assert m.start_run(ok)[1]['error'] == 'no_image'
m.state['apps']['abc123'] = {'state': 'failed', 'image': 'prgd-app-abc123:1'}
assert m.start_run(ok)[0] == 202 and started[0][1:] == ('run1', 'npx prisma db seed', 60, 'prgd-app-abc123:1')
assert m.start_run(ok)[1]['error'] == 'duplicate_run'
assert m.start_run({**ok, 'runId': 'run2'})[0] == 202
assert m.start_run({**ok, 'runId': 'run3'}) == (409, {'error': 'run_limit'})
m.state['runs']['run1'].update(status='succeeded', exitCode=0, finishedAt=m.time.time())
assert m.start_run({**ok, 'runId': 'run3'})[0] == 202
# Output is redacted with the app's secrets; finished runs are forgotten after a day.
import os
m.ROOT = tempfile.mkdtemp(); os.makedirs(m.ROOT + '/abc123/runs')
open(m.run_log('abc123', 'run1'), 'w').write('seeded with postgresql://u:pw@h/db and verysecret1\\n')
r = m.run_report('run1')
assert r['status'] == 'succeeded' and r['exitCode'] == 0 and 'verysecret1' not in r['output'] and ':pw@' not in r['output'], r
m.state['runs']['run1']['finishedAt'] = m.time.time() - 2 * 86400
with m.runs_lock: m.prune_runs()
assert 'run1' not in m.state['runs'] and not os.path.exists(m.run_log('abc123', 'run1'))
assert m.cancel_run('nope')[0] == 404
print('ok')`);
    expect(out).toBe('ok');
  });
});
