import { beforeAll, describe, expect, it } from 'vitest';
import { Client, signup, sut, totp, type Sut, type Team } from './harness';

let s: Sut;
beforeAll(async () => {
  s = await sut();
});

/** Turns on two factor sign in through the API; returns the secret. */
async function enableTotp(t: Team) {
  const setup = await t.client.ok('POST', '/v1/auth/totp/setup', {}, 201);
  const enabled = await t.client.ok('POST', '/v1/auth/totp/enable', { code: totp(setup.secret) }, 201);
  expect(enabled.recoveryCodes.length).toBeGreaterThan(0);
  return setup.secret as string;
}

async function login(t: Team, code?: string) {
  const c = new Client(s.baseUrl);
  const r = await c.post('/v1/auth/login', { email: t.email, password: t.password, ...(code ? { totp: code } : {}) });
  if (r.status === 200) c.token = r.body.session;
  return { r, c };
}

describe('back office staff', () => {
  it('limits a finance staff member to finance and requires two factor sign in', async () => {
    // Full staff is granted out of band (there is no API for the first one), then signs in with two factor.
    const admin = await signup(s);
    await s.prisma.user.update({ where: { id: admin.userId }, data: { isStaff: true, staffRoles: ['full_admin'] } });
    const adminSecret = await enableTotp(admin);
    const adminLogin = await login(admin, totp(adminSecret));
    expect(adminLogin.r.status).toBe(200);
    const boss = adminLogin.c;
    expect((await boss.get('/admin/v1/hosts')).status).toBe(200);

    // Finance only.
    const fin = await signup(s);
    const granted = await boss.ok('POST', `/admin/v1/staff/${fin.userId}`, { isStaff: true, staffRoles: ['finance'] }, 201);
    expect(granted.staffRoles).toEqual(['finance']);
    // Granting access ended the old sessions.
    expect((await fin.client.get('/v1/account')).status).toBe(401);

    const first = await login(fin);
    expect(first.r.status).toBe(200);
    fin.client = first.c;
    const me = await fin.client.ok('GET', '/v1/account');
    expect(me.staffRoles).toEqual(['finance']);
    expect(me.scopes).toContain('admin:finance');
    expect(me.scopes).not.toContain('admin');
    // No back office before two factor is on.
    const noTotp = await fin.client.get('/admin/v1/invoices');
    expect(noTotp.status).toBe(403);
    expect(noTotp.text).toContain('totp_setup_required');

    const secret = await enableTotp(fin);
    const without = await login(fin);
    expect(without.r.status).toBe(401);
    expect(without.r.text).toContain('totp_required');
    expect((await login(fin, '000000')).r.status).toBe(401);
    const signedIn = await login(fin, totp(secret));
    expect(signedIn.r.status).toBe(200);
    const f = signedIn.c;

    expect((await f.get('/admin/v1/invoices')).status).toBe(200);
    expect((await f.get('/admin/v1/payments')).status).toBe(200);
    expect((await f.get('/admin/v1/fx')).status).toBe(200);
    for (const path of ['/admin/v1/hosts', '/admin/v1/servers', '/admin/v1/teams', '/admin/v1/abuse']) {
      const r = await f.get(path);
      expect(r.status, path).toBe(403);
      expect(r.text).toContain('does not cover this part of the back office');
    }
    // Full staff only: granting staff access.
    expect((await f.post(`/admin/v1/staff/${admin.userId}`, { isStaff: false })).status).toBe(403);
    // Finance can add credit to a team.
    const credit = await f.ok('POST', `/admin/v1/teams/${admin.teamId}/credits`, { kind: 'goodwill', amountMinor: 1000, reason: 'test' }, 201);
    expect(credit.amountMinor).toBe(1000);

    // A customer never reaches the back office.
    const customer = await signup(s);
    const denied = await customer.client.get('/admin/v1/invoices');
    expect(denied.status).toBe(403);
  });
});
