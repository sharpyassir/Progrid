import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Client, signup, sut, type Sut } from './harness';
import { LEGAL_VERSION } from '../../src/modules/legal/legal';

/**
 * Clickwrap (modules/legal): nobody creates an account without ticking "I agree", every
 * acceptance is recorded, and a user who has not accepted the current version can only read
 * their account and accept until they do, from the console and through API tokens alike.
 */

let s: Sut;
beforeAll(async () => {
  s = await sut();
});

const body = (extra: Record<string, unknown> = {}) => ({
  email: `it-${randomBytes(6).toString('hex')}@example.test`, password: `pw-${randomBytes(9).toString('base64url')}`, name: 'Legal Test', teamName: 'legal test', country: 'SA', ...extra,
});

describe('legal acceptance', () => {
  it('publishes the current version and the documents of each company', async () => {
    const r = await new Client(s.baseUrl).ok('GET', '/v1/legal');
    expect(r.version).toBe(LEGAL_VERSION);
    expect(r.documents.map((d: { slug: string }) => d.slug)).toEqual(['terms', 'acceptable-use', 'privacy']);
    expect(r.documents[0].url).toMatch(/\/legal\/terms$/);
  });

  it('refuses a signup without the box ticked and records the one with it', async () => {
    const c = new Client(s.baseUrl);
    const no = await c.req('POST', '/v1/auth/signup', body());
    expect(no.status).toBe(400);
    expect(JSON.stringify(no.body)).toMatch(/accept the Terms of service/);
    expect((await c.req('POST', '/v1/auth/signup', body({ acceptTerms: false }))).status).toBe(400);

    const t = await signup(s); // the harness ticks the box
    const me = await t.client.ok('GET', '/v1/account');
    expect(me.legal).toMatchObject({ version: LEGAL_VERSION, accepted: LEGAL_VERSION, required: false, entity: 'progrid_arabia' });
    expect(me.legal.documents[0].url).toMatch(/\/legal\/terms$/);
    const rows = await s.prisma.legalAcceptance.findMany({ where: { userId: t.userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: LEGAL_VERSION, method: 'signup', entity: 'progrid_arabia', documents: ['terms', 'acceptable-use', 'privacy'] });
    expect(rows[0].ip).toBeTruthy();
    expect(rows[0].userAgent).toBeTruthy();
  });

  it('blocks a user on an older version until they accept, for sessions and tokens', async () => {
    const t = await signup(s);
    const token = (await t.client.ok('POST', '/v1/tokens', { name: 'ci', scopes: ['servers:read'] }, 201)).token as string;
    await s.prisma.user.update({ where: { id: t.userId }, data: { legalVersion: '2020-01-01' } });

    const blocked = await t.client.req('GET', '/v1/servers');
    expect(blocked.status).toBe(428);
    expect(blocked.body.error.code).toBe('legal_acceptance_required');
    const viaToken = await t.client.req('GET', '/v1/servers', undefined, { token });
    expect(viaToken.status).toBe(428);
    expect(viaToken.body.error.message).toMatch(/owner of this token/);

    // The console can still load the account and show the documents.
    const me = await t.client.ok('GET', '/v1/account');
    expect(me.legal).toMatchObject({ required: true, accepted: '2020-01-01' });

    // A token cannot accept for its owner; an outdated version is refused.
    expect((await t.client.req('POST', '/v1/legal/accept', { accept: true, version: LEGAL_VERSION }, { token })).status).toBe(403);
    expect((await t.client.req('POST', '/v1/legal/accept', { accept: true, version: '2020-01-01' })).status).toBe(400);
    expect((await t.client.req('POST', '/v1/legal/accept', { accept: false, version: LEGAL_VERSION })).status).toBe(400);

    const ok = await t.client.ok('POST', '/v1/legal/accept', { accept: true, version: LEGAL_VERSION }, 200);
    expect(ok).toMatchObject({ version: LEGAL_VERSION, required: false });
    await t.client.ok('GET', '/v1/servers');
    expect((await t.client.req('GET', '/v1/servers', undefined, { token })).status).toBe(200);

    const history = await t.client.ok('GET', '/v1/legal/acceptances');
    expect(history.data.map((r: { method: string }) => r.method)).toEqual(['reaccept', 'signup']);
    expect(await s.prisma.auditLog.count({ where: { action: 'legal.accepted', resource: `user:${t.userId}` } })).toBe(1);
  });
});
