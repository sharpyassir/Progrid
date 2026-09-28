import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { loadConfig } from '../../../config/config';

export interface MaintenanceTarget {
  assetId: string;
  name: string;
  /** Management network address (WireGuard or private IP). */
  host: string;
  os?: string | null;
}

export interface MaintenanceJob {
  runId: string;
  kind: 'PATCHING' | 'BACKUP_TEST' | 'CUSTOM';
  playbook: string;
  vars: Record<string, unknown>;
  targets: MaintenanceTarget[];
}

export interface MaintenanceResult {
  ok: boolean;
  log: string;
  error?: string;
}

/** Runs a maintenance playbook against the targets and reports the outcome with a log. */
export interface MaintenanceRunner {
  readonly name: string;
  run(job: MaintenanceJob): Promise<MaintenanceResult>;
}

export const PLAYBOOK_NAME = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\.ya?ml$/;

/**
 * Development and tests: touches nothing and writes a log shaped like an Ansible run. Set
 * `simulateFailure: true` in the task vars to make it fail.
 */
export class FakeMaintenanceRunner implements MaintenanceRunner {
  readonly name = 'fake';
  async run(job: MaintenanceJob): Promise<MaintenanceResult> {
    const fail = job.vars.simulateFailure === true;
    const at = new Date().toISOString();
    const lines = [`PLAY [${job.playbook}] (fake runner, run ${job.runId}, ${at}) ****`];
    if (!job.targets.length) return { ok: false, log: `${lines[0]}\nno hosts matched: no approved asset has a management address`, error: 'no targets' };
    const task = job.kind === 'PATCHING' ? 'Upgrade packages' : job.kind === 'BACKUP_TEST' ? 'Restore a test file from the latest backup' : 'Run playbook';
    lines.push('', 'TASK [Gathering Facts] ****');
    for (const t of job.targets) lines.push(`ok: [${t.name}] (${t.host})`);
    lines.push('', `TASK [${task}] ****`);
    for (const t of job.targets) lines.push(fail ? `fatal: [${t.name}]: FAILED! => {"msg": "simulated failure"}` : job.kind === 'PATCHING' ? `changed: [${t.name}] => 12 packages upgraded, reboot not required` : `ok: [${t.name}]`);
    lines.push('', 'PLAY RECAP ****');
    for (const t of job.targets) lines.push(`${t.name.padEnd(24)} : ok=${fail ? 1 : 2}    changed=${fail || job.kind !== 'PATCHING' ? 0 : 1}    unreachable=0    failed=${fail ? 1 : 0}`);
    return { ok: !fail, log: lines.join('\n'), ...(fail ? { error: 'simulated failure' } : {}) };
  }
}

/**
 * Runs `ansible-playbook` on the worker host against the assets' management addresses. The
 * inventory is written per run; the playbook comes from MAINTENANCE_PLAYBOOK_DIR. SSH uses
 * MAINTENANCE_SSH_USER and MAINTENANCE_SSH_KEY_FILE (or the worker's agent), and the run is
 * killed after MAINTENANCE_TIMEOUT_MINUTES.
 */
export class AnsibleMaintenanceRunner implements MaintenanceRunner {
  readonly name = 'ansible';

  async run(job: MaintenanceJob): Promise<MaintenanceResult> {
    const c = loadConfig();
    if (!PLAYBOOK_NAME.test(job.playbook)) return { ok: false, log: '', error: `bad playbook name ${job.playbook}` };
    const dir = isAbsolute(c.MAINTENANCE_PLAYBOOK_DIR) ? c.MAINTENANCE_PLAYBOOK_DIR : resolve(process.cwd(), c.MAINTENANCE_PLAYBOOK_DIR);
    const playbook = join(dir, job.playbook);
    if (!existsSync(playbook)) return { ok: false, log: '', error: `playbook ${playbook} not found (MAINTENANCE_PLAYBOOK_DIR)` };
    if (!job.targets.length) return { ok: false, log: 'no approved asset of this task has a management address', error: 'no targets' };

    const work = await mkdtemp(join(tmpdir(), 'prgd-maint-'));
    try {
      const hostLine = (t: MaintenanceTarget) => `${t.name.replace(/[^A-Za-z0-9_.-]/g, '_')} ansible_host=${t.host} prgd_asset_id=${t.assetId}`;
      await writeFile(join(work, 'inventory.ini'), `[managed]\n${job.targets.map(hostLine).join('\n')}\n\n[managed:vars]\nansible_user=${c.MAINTENANCE_SSH_USER}\n`, { mode: 0o600 });
      await writeFile(join(work, 'vars.json'), JSON.stringify({ ...job.vars, prgd_run_id: job.runId, prgd_kind: job.kind }), { mode: 0o600 });
      const args = ['-i', join(work, 'inventory.ini'), '-e', `@${join(work, 'vars.json')}`, ...(c.MAINTENANCE_SSH_KEY_FILE ? ['--private-key', c.MAINTENANCE_SSH_KEY_FILE] : []), playbook];
      return await new Promise<MaintenanceResult>((done) => {
        let out = '';
        const cap = 200_000;
        const child = spawn('ansible-playbook', args, { cwd: dir, env: { ...process.env, ANSIBLE_FORCE_COLOR: '0', ANSIBLE_NOCOLOR: '1', ANSIBLE_RETRY_FILES_ENABLED: '0' } });
        const collect = (b: Buffer) => {
          if (out.length < cap) out += b.toString();
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        const timer = setTimeout(() => child.kill('SIGTERM'), c.MAINTENANCE_TIMEOUT_MINUTES * 60_000);
        child.on('error', (e) => {
          clearTimeout(timer);
          done({ ok: false, log: out, error: `could not start ansible-playbook: ${e.message}` });
        });
        child.on('close', (code, signal) => {
          clearTimeout(timer);
          const log = out.length >= cap ? `${out}\n[log truncated]` : out;
          done(code === 0 ? { ok: true, log } : { ok: false, log, error: signal ? `killed by ${signal} after the timeout` : `ansible-playbook exited with ${code}` });
        });
      });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}

export function runnerFor(name = loadConfig().MAINTENANCE_RUNNER): MaintenanceRunner {
  return name === 'ansible' ? new AnsibleMaintenanceRunner() : new FakeMaintenanceRunner();
}
