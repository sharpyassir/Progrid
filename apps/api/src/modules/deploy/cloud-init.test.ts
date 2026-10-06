import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderDeployCloudInit } from './cloud-init';

const has = (cmd: string) => spawnSync(cmd, ['--version']).status === 0;

/** The content of one write_files entry (a `content: |` block indented by six spaces). */
function fileContent(cloudInit: string, path: string): string {
  const lines = cloudInit.split('\n');
  const start = lines.indexOf(`  - path: ${path}`);
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('  - path:') || /^\S/.test(l)) break;
    if (l.startsWith('    ')) {
      if (/^ {4}\S/.test(l)) continue; // permissions:, content:
      out.push(l.slice(6));
    } else out.push('');
  }
  return out.join('\n');
}

describe('git deploy cloud-init', () => {
  const ci = renderDeployCloudInit({ repoUrl: 'https://github.com/acme/app', branch: 'main', port: 3000, vmSecret: 'vmsecret', envVars: { A: '1' }, gitToken: 'ghs_TOKENVALUE123' });
  const deploySh = fileContent(ci, '/opt/prgd/deploy.sh');

  it('never puts the token in the clone URL', () => {
    expect(deploySh).not.toContain('x-access-token:$TOKEN@');
    expect(deploySh).toContain('GIT_CONFIG_KEY_0=http.extraHeader');
    expect(deploySh).toContain('git -C "$DIR" remote set-url origin "$REPO"');
    expect(deploySh).toContain("sed -u -E 's#://[^/@[:space:]]+:[^/@[:space:]]+@#://***@#g'");
  });

  it('checks the secret in constant time', () => {
    expect(ci).toContain("if not secret_ok(self.headers.get('X-Prgd-Secret'))");
    expect(ci).not.toContain('!= SECRET');
  });

  it.skipIf(!has('bash'))('deploy.sh parses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deploy-'));
    writeFileSync(join(dir, 'deploy.sh'), deploySh);
    const r = spawnSync('bash', ['-n', join(dir, 'deploy.sh')], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
  });

  it.skipIf(!has('python3'))('deployd compiles', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deploy-'));
    writeFileSync(join(dir, 'deployd.py'), fileContent(ci, '/opt/prgd/deployd.py'));
    const r = spawnSync('python3', ['-m', 'py_compile', join(dir, 'deployd.py')], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it.skipIf(!has('bash') || !has('git'))('git gets the token as a basic auth header, not in the config', () => {
    // Run the token part of deploy.sh and ask git what it would send.
    const dir = mkdtempSync(join(tmpdir(), 'deploy-'));
    writeFileSync(join(dir, 'git.token'), 'ghs_TOKENVALUE123');
    const head = deploySh.split('BRANCH=')[0].replace('/opt/prgd/git.token', join(dir, 'git.token'));
    const r = spawnSync('bash', ['-c', `${head}\ngit config --get http.extraHeader; echo "token=\${TOKEN:-}"`], { encoding: 'utf8' });
    expect(r.stdout).toContain(`Authorization: Basic ${Buffer.from('x-access-token:ghs_TOKENVALUE123').toString('base64')}`);
    expect(r.stdout).toContain('token=\n');
  });
});
