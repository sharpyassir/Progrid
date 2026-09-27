import { beforeAll, describe, expect, it } from 'vitest';
import { Client, signup, sut, topUp, type Sut } from './harness';

let s: Sut;
beforeAll(async () => {
  s = await sut();
});

describe('accounts and access', () => {
  it('signs up, confirms the email, logs in and revokes a session', async () => {
    const t = await signup(s);
    const me = await t.client.ok('GET', '/v1/account');
    expect(me.user.email).toBe(t.email);
    expect(me.user.emailVerified).toBe(true);
    expect(me.role).toBe('owner');

    // Wrong password, then a second session from another device.
    const other = new Client(s.baseUrl);
    expect((await other.post('/v1/auth/login', { email: t.email, password: 'not-the-password' })).status).toBe(401);
    const login = await other.ok('POST', '/v1/auth/login', { email: t.email, password: t.password }, 200);
    other.token = login.session;
    expect((await other.get('/v1/account')).status).toBe(200);

    const sessions = await t.client.ok('GET', '/v1/account/sessions');
    expect(sessions.data.length).toBe(2);
    const second = sessions.data.find((x: { current: boolean }) => !x.current);
    await t.client.ok('DELETE', `/v1/account/sessions/${second.id}`, undefined, 204);
    expect((await other.get('/v1/account')).status).toBe(401);
    expect((await t.client.get('/v1/account')).status).toBe(200);

    // Logout ends the session on the server, not only in the browser.
    await t.client.ok('POST', '/v1/auth/logout', undefined, 204);
    expect((await t.client.get('/v1/account')).status).toBe(401);
  });

  it('issues API tokens limited to their scopes and never above the creator', async () => {
    const t = await signup(s);
    const tok = await t.client.ok('POST', '/v1/tokens', { name: 'ci', scopes: ['servers:read'] }, 201);
    expect(tok.token).toMatch(/^pgc_/);
    const api = new Client(s.baseUrl, tok.token);
    expect((await api.get('/v1/servers')).status).toBe(200);
    const denied = await api.post('/v1/servers', { name: 'nope', size: 's-1vcpu-2gb', image: 'ubuntu-24-04' });
    expect(denied.status).toBe(403);
    expect(denied.text).toContain('servers:write');
    expect((await api.get('/v1/tokens')).status).toBe(403);
    // Staff scope cannot be granted by a customer.
    expect((await t.client.post('/v1/tokens', { name: 'x', scopes: ['admin'] })).status).toBe(403);
    // Revoked tokens stop working at once.
    await t.client.ok('DELETE', `/v1/tokens/${tok.id}`, undefined, 204);
    expect((await api.get('/v1/servers')).status).toBe(401);
  });

  it('asks for a first top up before billable resources, then lets the team create them', async () => {
    const t = await signup(s);
    const refused = await t.client.post('/v1/servers', { name: 'gate', size: 's-1vcpu-2gb', image: 'ubuntu-24-04' });
    expect(refused.status).toBe(402);
    expect(refused.body.code ?? refused.body.error?.code).toBe('payment_required');

    await topUp(s, t, 20_000);
    const bal = await t.client.ok('GET', '/v1/billing/balance');
    expect(JSON.stringify(bal)).toContain('20000');
    const created = await t.client.post('/v1/servers', { name: 'gate', size: 's-1vcpu-2gb', image: 'ubuntu-24-04' });
    expect(created.status).toBe(202);
  });
});
