import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, signup, sut, totp, type Sut, type Team } from './harness';
import { PlatformService } from '../../src/modules/ops/platform/platform.service';
import { PlatformChecks, type CheckResult } from '../../src/modules/ops/platform/checks';
import { PLATFORM_TASKS } from '../../src/modules/ops/platform/catalog';

/**
 * Platform maintenance (docs/platform-maintenance.md): periods, automatic checks that close
 * tasks, closing by hand with evidence, overdue mail, backup reports and failed sign in audit.
 */

let s: Sut;
let eng: Team & { ops: Client };
let platform: PlatformService;
let checks: PlatformChecks;

beforeAll(async () => {
  s = await sut();
  platform = s.get(PlatformService);
  checks = s.get(PlatformChecks);
  await s.prisma.platformTaskRun.deleteMany({});
  // Full staff with a second factor is an internal engineer in the ops console.
  const t = await signup(s);
  await s.prisma.user.update({ where: { id: t.userId }, data: { isStaff: true, staffRoles: [] } });
  const setup = await t.client.ok('POST', '/v1/auth/totp/setup', {}, 201);
  await t.client.ok('POST', '/v1/auth/totp/enable', { code: totp(setup.secret) }, 201);
  const ops = new Client(s.baseUrl);
  const login = await ops.ok('POST', '/ops/v1/auth/login', { email: t.email, password: t.password }, 200);
  ops.token = (await ops.ok('POST', '/ops/v1/auth/totp', { challenge: login.challenge, code: totp(setup.secret) }, 200)).session;
  eng = { ...t, ops };
});

afterAll(async () => {
  await s.prisma.platformTaskRun.deleteMany({});
  await s.prisma.user.update({ where: { id: eng.userId }, data: { isStaff: false, staffRoles: [] } });
});

const overview = () => eng.ops.ok('GET', '/ops/v1/platform');
const runOf = async (key: string) => (await overview()).current.find((r: { taskKey: string }) => r.taskKey === key);
const backup = (body: unknown, secret: string | null = 'it-platform-secret') =>
  fetch(`${s.baseUrl}/internal/platform/backup`, { method: 'POST', headers: { 'content-type': 'application/json', ...(secret !== null ? { 'x-prgd-platform-secret': secret } : {}) }, body: JSON.stringify(body) });

/** Makes the check of `key` return `status` until restored. */
function stubCheck(results: Partial<Record<string, CheckResult['status']>>) {
  const real = checks.run.bind(checks);
  checks.run = (async (key, now) => (results[key] ? { status: results[key]!, summary: `stub ${results[key]}`, details: {}, items: [{ label: 'Stub', status: results[key]!, detail: 'x' }] } : real(key, now))) as typeof checks.run;
  return () => { checks.run = real; };
}

describe('platform maintenance', () => {
  it('opens one run per task for the current period, for engineers only', async () => {
    const o = await overview();
    expect(o.current).toHaveLength(PLATFORM_TASKS.length);
    expect(o.current.every((r: { status: string }) => r.status === 'open')).toBe(true);
    expect(o.current.find((r: { taskKey: string }) => r.taskKey === 'weekly.backups').periodKey).toMatch(/^\d{4}-W\d{2}$/);
    expect(o.current.find((r: { taskKey: string }) => r.taskKey === 'quarterly.dr_drill').periodKey).toMatch(/^\d{4}-Q[1-4]$/);
    expect(o.month.estimateMinutes).toBeGreaterThan(0);
    // Idempotent.
    await platform.ensurePeriods();
    expect(await s.prisma.platformTaskRun.count()).toBe(PLATFORM_TASKS.length);
    // A console session is not an ops session.
    const customer = await signup(s);
    expect((await customer.client.req('GET', '/ops/v1/platform')).status).toBe(401);
  });

  it('closes automatic tasks that pass and leaves warnings for the engineer', async () => {
    const restore = stubCheck({ abuse: 'pass', monitoring: 'warn', patching: 'pass' });
    try {
      await platform.runChecks();
    } finally {
      restore();
    }
    const abuse = await runOf('weekly.abuse');
    expect(abuse).toMatchObject({ status: 'passed', check: { status: 'pass' } });
    expect(abuse.completedAt).toBeTruthy();
    const monitoring = await runOf('weekly.monitoring');
    expect(monitoring).toMatchObject({ status: 'attention', check: { status: 'warn', items: [{ label: 'Stub' }] } });
    // Assisted tasks keep the result but stay open even when the check passes.
    expect(await runOf('weekly.patching')).toMatchObject({ status: 'open', check: { status: 'pass' } });

    // A warning needs the reason it is fine.
    expect((await eng.ops.req('POST', `/ops/v1/platform/runs/${monitoring.id}/complete`, {})).status).toBe(422);
    const done = await eng.ops.ok('POST', `/ops/v1/platform/runs/${monitoring.id}/complete`, { note: 'Alert on host pve1 was a planned reboot', minutes: 10 }, 200);
    expect(done).toMatchObject({ status: 'done', minutes: 10, completedBy: { id: eng.userId } });
    expect((await eng.ops.req('POST', `/ops/v1/platform/runs/${monitoring.id}/complete`, { note: 'again' })).status).toBe(409);
    expect(await s.prisma.auditLog.count({ where: { action: 'ops.platform_task_done', resource: monitoring.id } })).toBe(1);
  });

  it('requires evidence where the task says so, and has no check for manual tasks', async () => {
    const restore = await runOf('monthly.restore_test');
    expect((await eng.ops.req('POST', `/ops/v1/platform/runs/${restore.id}/check`)).status).toBe(422);
    const noEvidence = await eng.ops.req('POST', `/ops/v1/platform/runs/${restore.id}/complete`, { note: 'Restored' });
    expect(noEvidence.status).toBe(422);
    const done = await eng.ops.ok('POST', `/ops/v1/platform/runs/${restore.id}/complete`, { note: 'Restored into scratch db', evidence: 'pg_restore: 4m12s, 1,204 users', minutes: 55 }, 200);
    expect(done).toMatchObject({ status: 'done', evidence: 'pg_restore: 4m12s, 1,204 users' });
    const o = await overview();
    expect(o.month.minutes).toBe(65);
    expect(o.history.map((r: { id: string }) => r.id)).toContain(restore.id);
  });

  it('runs a check on demand with the real probes stubbed', async () => {
    const real = { ...checks.probes };
    checks.probes.tlsDaysLeft = async () => 10;
    checks.probes.resolve = async () => '192.0.2.10';
    checks.probes.portOpen = async (_h: string, port: number) => [22, 443, 5432].includes(port);
    try {
      const audit = await runOf('quarterly.security_audit');
      const r = await eng.ops.ok('POST', `/ops/v1/platform/runs/${audit.id}/check`, {}, 200);
      expect(r.status).toBe('open');
      expect(r.check.status).toBe('fail');
      const items = r.check.items as { label: string; status: string; detail: string }[];
      expect(items.find((i) => i.label.startsWith('TLS'))).toMatchObject({ status: 'fail', detail: 'expires in 10 days' });
      expect(items.find((i) => i.label.startsWith('Open ports'))).toMatchObject({ status: 'fail' });
      expect(items.find((i) => i.label.startsWith('Open ports'))!.detail).toContain('5432');
    } finally {
      Object.assign(checks.probes, real);
    }
  });

  it('takes backup reports from the backup job and grades them', async () => {
    expect((await backup({ result: 'ok' }, null)).status).toBe(401);
    expect((await backup({ result: 'ok' }, 'wrong')).status).toBe(401);
    const item = async () => (await checks.run('backups')).items.find((i) => i.label === 'Platform database backup')!;

    expect((await backup({ result: 'ok', offsite: false, sizeBytes: 1000, file: 'all-1.sql.gz' })).status).toBe(200);
    expect(await item()).toMatchObject({ status: 'warn' });
    expect((await item()).detail).toContain('BACKUP_S3_URL');

    await backup({ result: 'ok', offsite: true, sizeBytes: 1000, file: 'all-2.sql.gz' });
    expect(await item()).toMatchObject({ status: 'pass' });

    const before = s.outbox.length;
    await new Promise((r) => setTimeout(r, 5));
    await backup({ result: 'failed', offsite: false, file: 'all-3.sql.gz' });
    expect(await item()).toMatchObject({ status: 'fail' });
    expect(s.outbox.slice(before).some((m) => m.to === 'support@progrid.sa' && m.subject === 'Platform database backup failed')).toBe(true);
  });

  it('marks unclosed tasks overdue and mails the staff inbox once', async () => {
    const later = new Date(Date.now() + 120 * 86_400_000);
    const before = s.outbox.length;
    const n = await platform.markOverdue(later);
    expect(n).toBeGreaterThan(0);
    const mails = s.outbox.slice(before).filter((m) => m.to === 'support@progrid.sa' && m.subject.startsWith('Platform maintenance overdue'));
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toContain('quarterly.dr_drill');
    expect(mails[0].text).not.toContain('monthly.restore_test');
    expect(await platform.markOverdue(later)).toBe(0);
    // Closed runs stay closed; the new period opens fresh and the old ones are the backlog.
    expect((await s.prisma.platformTaskRun.findFirst({ where: { taskKey: 'monthly.restore_test' } }))!.status).toBe('done');
    await platform.ensurePeriods(later);
    const o = await platform.overview(later);
    expect(o.backlog.length).toBe(n);
    expect(o.current.every((r) => r.status === 'open')).toBe(true);
  });

  it('records failed sign ins for the access review', async () => {
    const bad = new Client(s.baseUrl);
    expect((await bad.req('POST', '/v1/auth/login', { email: eng.email, password: 'wrong-password-1' })).status).toBe(401);
    expect((await bad.req('POST', '/ops/v1/auth/login', { email: eng.email, password: 'wrong-password-1' })).status).toBe(401);
    expect(await s.prisma.auditLog.count({ where: { action: 'auth.login_failed', request: { path: ['email'], equals: eng.email } } })).toBeGreaterThanOrEqual(1);
    expect(await s.prisma.auditLog.count({ where: { action: 'ops.signin_failed', userId: eng.userId } })).toBeGreaterThanOrEqual(1);
    const access = await checks.run('access');
    expect(access.items.find((i) => i.label === 'Failed sign ins (30 days)')!.detail).toMatch(/^\d+/);
  });
});
