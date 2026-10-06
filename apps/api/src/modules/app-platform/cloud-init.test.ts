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
});
