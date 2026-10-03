import { LEGAL_VERSION } from '../../src/modules/legal/legal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';
import { Client, signup, sut, totp, type Sut } from './harness';
import { OidcProviders } from '../../src/modules/oauth/providers';
import { MS_PERSONAL_TENANT } from '../../src/modules/oauth/linking';

/**
 * Social sign in against a tiny OpenID Connect provider run by the test: discovery, a key set
 * and a token endpoint that checks the PKCE verifier and signs id tokens with a test key. The
 * test plays the browser: it follows /start, "approves" at the provider by minting a code for
 * chosen claims, and brings the code back to /callback with the cookie /start set.
 */

const WORK_TENANT = '3f1c2a9e-5b7d-4e21-9c0a-6d8e7f9a1b2c';

interface Grant { claims: Record<string, unknown>; nonce: string; challenge: string; clientId: string; redirectUri: string; issuer: string }

class FakeOidc {
  server!: Server;
  base = '';
  key!: KeyLike;
  jwk!: JWK;
  grants = new Map<string, Grant>();
  /** Makes the next token response carry this nonce instead of the one from the request. */
  forceNonce?: string;

  async start() {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    this.key = privateKey;
    this.jwk = { ...(await exportJWK(publicKey)), kid: 'it-key', alg: 'RS256', use: 'sig' };
    this.server = createServer((req, res) => void this.handle(req, res).catch((e) => { res.statusCode = 500; res.end(String(e)); }));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  issuer(provider: 'google' | 'microsoft', tid?: string) {
    return provider === 'google' ? `${this.base}/google` : `${this.base}/ms/${tid ?? '{tenantid}'}/v2.0`;
  }

  discoveryUrl(provider: 'google' | 'microsoft') {
    return `${provider === 'google' ? `${this.base}/google` : `${this.base}/ms/common/v2.0`}/.well-known/openid-configuration`;
  }

  private async handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
    const url = new URL(req.url!, this.base);
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname.endsWith('/.well-known/openid-configuration')) {
      const provider = url.pathname.startsWith('/google') ? 'google' : 'microsoft';
      const prefix = provider === 'google' ? '/google' : '/ms/common/v2.0';
      return json(200, { issuer: this.issuer(provider), authorization_endpoint: `${this.base}${prefix}/authorize`, token_endpoint: `${this.base}${prefix}/token`, jwks_uri: `${this.base}/jwks` });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [this.jwk] });
    if (url.pathname.endsWith('/token') && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const f = new URLSearchParams(raw);
      const g = this.grants.get(f.get('code') ?? '');
      this.grants.delete(f.get('code') ?? '');
      if (!g) return json(400, { error: 'invalid_grant' });
      if (f.get('client_secret') !== 'it-secret' || f.get('client_id') !== g.clientId) return json(401, { error: 'invalid_client' });
      if (f.get('redirect_uri') !== g.redirectUri) return json(400, { error: 'invalid_grant', error_description: 'redirect_uri' });
      const challenge = createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url');
      if (challenge !== g.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE' });
      const idToken = await new SignJWT({ ...g.claims, nonce: this.forceNonce ?? g.nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'it-key' })
        .setIssuer(g.issuer)
        .setAudience(g.clientId)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(this.key);
      this.forceNonce = undefined;
      return json(200, { access_token: 'unused', token_type: 'Bearer', id_token: idToken });
    }
    json(404, { error: 'not_found' });
  }
}

let s: Sut;
const idp = new FakeOidc();

beforeAll(async () => {
  s = await sut();
  await idp.start();
  const providers = s.get(OidcProviders);
  providers.override('google', { clientId: 'it-google', clientSecret: 'it-secret', discoveryUrl: idp.discoveryUrl('google') });
  providers.override('microsoft', { clientId: 'it-microsoft', clientSecret: 'it-secret', discoveryUrl: idp.discoveryUrl('microsoft'), tenant: 'common' });
});

afterAll(async () => {
  const providers = s.get(OidcProviders);
  providers.override('google', null);
  providers.override('microsoft', null);
  await new Promise((r) => idp.server?.close(r));
});

const newEmail = () => `oauth-${randomBytes(5).toString('hex')}@example.test`;
const googleClaims = (email: string, extra: Record<string, unknown> = {}) => ({ sub: `g-${randomBytes(6).toString('hex')}`, email, email_verified: true, name: 'Nora Alharbi', ...extra });
const msClaims = (email: string, tid: string, extra: Record<string, unknown> = {}) => ({ sub: `m-${randomBytes(6).toString('hex')}`, email, tid, name: 'Faisal Alotaibi', ...extra });

interface Browser { client: Client; cookie?: string }

/** GET /start as the browser would: returns the provider URL and the cookie that was set. */
async function begin(b: Browser, provider: 'google' | 'microsoft', query: Record<string, string> = {}) {
  // The console sends the version the person agreed to; pass legal: '' to leave the box unticked.
  const q = { legal: LEGAL_VERSION, ...query };
  if (!q.legal) delete (q as Record<string, string>).legal;
  const r = await fetch(`${s.baseUrl}/v1/auth/oauth/${provider}/start?${new URLSearchParams(q)}`, { redirect: 'manual', headers: { 'x-forwarded-for': b.client.ip } });
  expect(r.status).toBe(302);
  const location = new URL(r.headers.get('location')!);
  const setCookie = r.headers.get('set-cookie') ?? '';
  const m = /prgd_oauth=([^;]+)/.exec(setCookie);
  if (m) {
    b.cookie = m[1];
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  }
  return location;
}

/** The provider approves: mint a code for these claims bound to the request's nonce and PKCE challenge. */
function approve(authorize: URL, provider: 'google' | 'microsoft', claims: Record<string, unknown>) {
  const code = randomBytes(12).toString('hex');
  idp.grants.set(code, {
    claims,
    nonce: authorize.searchParams.get('nonce')!,
    challenge: authorize.searchParams.get('code_challenge')!,
    clientId: authorize.searchParams.get('client_id')!,
    redirectUri: authorize.searchParams.get('redirect_uri')!,
    issuer: idp.issuer(provider, claims.tid as string | undefined),
  });
  return code;
}

/** GET /callback as the browser: returns the console URL the API redirects to. */
async function back(b: Browser, provider: 'google' | 'microsoft', params: Record<string, string>, cookie = b.cookie) {
  const r = await fetch(`${s.baseUrl}/v1/auth/oauth/${provider}/callback?${new URLSearchParams(params)}`, { redirect: 'manual', headers: { 'x-forwarded-for': b.client.ip, ...(cookie ? { cookie: `prgd_oauth=${cookie}` } : {}) } });
  expect(r.status).toBe(302);
  return new URL(r.headers.get('location')!);
}

/** The whole round trip up to the console callback page. */
async function socialRound(b: Browser, provider: 'google' | 'microsoft', claims: Record<string, unknown>, query: Record<string, string> = {}) {
  const authorize = await begin(b, provider, query);
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorize.searchParams.get('scope')).toBe('openid email profile');
  const code = approve(authorize, provider, claims);
  return back(b, provider, { code, state: authorize.searchParams.get('state')! });
}

describe('social sign in', () => {
  it('lists the configured providers', async () => {
    const r = await new Client(s.baseUrl).ok('GET', '/v1/auth/providers');
    expect(r.providers.map((p: { id: string }) => p.id)).toEqual(['google', 'microsoft']);
  });

  it('asks a social sign up that did not tick the box to accept before using anything', async () => {
    const b: Browser = { client: new Client(s.baseUrl) };
    const landing = await socialRound(b, 'google', googleClaims(newEmail()), { intent: 'signup', country: 'US', legal: '' });
    const res = await b.client.ok('POST', '/v1/auth/oauth/exchange', { code: landing.searchParams.get('code') }, 200);
    b.client.token = res.session;
    expect((await b.client.ok('GET', '/v1/account')).legal).toMatchObject({ required: true, accepted: null, entity: 'progrid_llc' });
    expect((await b.client.req('GET', '/v1/servers')).status).toBe(428);
    await b.client.ok('POST', '/v1/legal/accept', { accept: true, version: LEGAL_VERSION }, 200);
    await b.client.ok('GET', '/v1/servers');
    expect((await s.prisma.legalAcceptance.findMany({ where: { userId: res.user.id } })).map((r) => r.method)).toEqual(['reaccept']);
  });

  it('signs up a new person with a new team and a verified email', async () => {
    const b: Browser = { client: new Client(s.baseUrl) };
    const email = newEmail();
    const landing = await socialRound(b, 'google', googleClaims(email), { intent: 'signup', locale: 'ar', country: 'SA' });
    expect(landing.pathname).toBe('/auth/callback');
    expect(landing.searchParams.get('error')).toBeNull();
    expect(landing.toString()).not.toMatch(/session|eyJ/); // never a session token in a URL
    const res = await b.client.ok('POST', '/v1/auth/oauth/exchange', { code: landing.searchParams.get('code') }, 200);
    expect(res.created).toBe(true);
    expect(res.returnTo).toBe('/security?welcome=1');
    expect(res.user.email).toBe(email);
    expect(res.user.emailVerified).toBe(true);
    expect(res.user.locale).toBe('ar');
    expect(res.team.name).toBe('Nora Alharbi');
    expect(res.team.country).toBe('SA');
    expect(res.team.currency).toBe('SAR');
    expect(res.team.billingEntity).toBe('progrid_arabia');
    expect(res.team.status).toBe('active');
    expect(res.teams).toHaveLength(1);
    b.client.token = res.session;
    const me = await b.client.ok('GET', '/v1/account');
    expect(me.role).toBe('owner');
    expect(me.team.projects[0].slug).toBe('default');
    expect(me.legal).toMatchObject({ required: false, accepted: LEGAL_VERSION });
    expect((await s.prisma.legalAcceptance.findFirstOrThrow({ where: { userId: res.user.id } })).method).toBe('oauth_signup');

    const ids = await b.client.ok('GET', '/v1/account/identities');
    expect(ids.hasPassword).toBe(false);
    expect(ids.data).toHaveLength(1);
    expect(ids.data[0]).toMatchObject({ provider: 'google', email, emailVerified: true });

    // No password: password login says which button to use.
    const pw = await new Client(s.baseUrl).post('/v1/auth/login', { email, password: 'whatever-password' });
    expect(pw.status).toBe(401);
    expect(pw.text).toContain('password_not_set');
    expect(pw.text).toContain('Continue with Google');

    // The same Google account signs in again to the same user, without creating anything.
    const { subject } = await s.prisma.oAuthIdentity.findFirstOrThrow({ where: { email } });
    const again = await socialRound({ client: new Client(s.baseUrl) }, 'google', { ...googleClaims(email), sub: subject });
    const second = await b.client.ok('POST', '/v1/auth/oauth/exchange', { code: again.searchParams.get('code') }, 200);
    expect(second.created).toBe(false);
    expect(second.user.id).toBe(res.user.id);

    // Audit trail.
    const audit = await s.prisma.auditLog.findMany({ where: { resource: `user:${res.user.id}` }, select: { action: true } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['user.oauth_signup', 'user.identity_linked', 'user.signed_in']));
  });

  it('links a verified Google email to the existing account automatically', async () => {
    const t = await signup(s);
    const b: Browser = { client: new Client(s.baseUrl) };
    const landing = await socialRound(b, 'google', googleClaims(t.email));
    const res = await b.client.ok('POST', '/v1/auth/oauth/exchange', { code: landing.searchParams.get('code') }, 200);
    expect(res.user.id).toBe(t.userId);
    expect(res.created).toBe(false);
    expect(res.team.id).toBe(t.teamId);
    expect(await s.prisma.oAuthIdentity.count({ where: { userId: t.userId, provider: 'google' } })).toBe(1);
    // A personal Microsoft account is verified by Microsoft, so it links too.
    const ms = await socialRound(b, 'microsoft', msClaims(t.email, MS_PERSONAL_TENANT));
    expect((await b.client.ok('POST', '/v1/auth/oauth/exchange', { code: ms.searchParams.get('code') }, 200)).user.id).toBe(t.userId);
  });

  it('does not link a Microsoft work account whose email the directory has not verified', async () => {
    const t = await signup(s);
    const b: Browser = { client: new Client(s.baseUrl) };
    const landing = await socialRound(b, 'microsoft', msClaims(t.email, WORK_TENANT));
    expect(landing.searchParams.get('error')).toBe('link_from_security');
    expect(landing.searchParams.get('code')).toBeNull();
    expect(await s.prisma.oAuthIdentity.count({ where: { userId: t.userId } })).toBe(0);
    // An unverified Google address is refused the same way.
    const g = await socialRound(b, 'google', googleClaims(t.email, { email_verified: false }));
    expect(g.searchParams.get('error')).toBe('link_from_security');
    // With xms_edov the directory vouches for the domain, and the account links.
    const ok = await socialRound(b, 'microsoft', msClaims(t.email, WORK_TENANT, { xms_edov: true }));
    expect((await b.client.ok('POST', '/v1/auth/oauth/exchange', { code: ok.searchParams.get('code') }, 200)).user.id).toBe(t.userId);
    const row = await s.prisma.oAuthIdentity.findFirstOrThrow({ where: { userId: t.userId } });
    expect(row.tenantId).toBe(WORK_TENANT);
  });

  it('drops an unproven identity once the real owner of the address proves it', async () => {
    // Someone creates an account with another person's address through a work directory that did not verify it.
    const email = newEmail();
    const attacker: Browser = { client: new Client(s.baseUrl) };
    const made = await socialRound(attacker, 'microsoft', msClaims(email, WORK_TENANT));
    const first = await attacker.client.ok('POST', '/v1/auth/oauth/exchange', { code: made.searchParams.get('code') }, 200);
    expect(first.user.emailVerified).toBe(false);
    expect(first.team.status).toBe('pending_verification');
    const attackerSub = (await s.prisma.oAuthIdentity.findFirstOrThrow({ where: { userId: first.user.id } })).subject;

    // The owner of the mailbox arrives with Google, which vouches for the address.
    const owner: Browser = { client: new Client(s.baseUrl) };
    const g = await socialRound(owner, 'google', googleClaims(email));
    const res = await owner.client.ok('POST', '/v1/auth/oauth/exchange', { code: g.searchParams.get('code') }, 200);
    expect(res.user.id).toBe(first.user.id);
    expect(res.user.emailVerified).toBe(true);
    const ids = await s.prisma.oAuthIdentity.findMany({ where: { userId: first.user.id } });
    expect(ids.map((i) => i.provider)).toEqual(['google']);
    expect((await s.prisma.team.findUniqueOrThrow({ where: { id: first.team.id } })).status).toBe('active');

    // The Microsoft account no longer reaches it: it would now create a new account, which the taken address refuses.
    const again = await socialRound(attacker, 'microsoft', { ...msClaims(email, WORK_TENANT), sub: attackerSub });
    expect(again.searchParams.get('error')).toBe('link_from_security');
  });

  it('refuses a Microsoft token whose issuer does not match its tenant', async () => {
    const b: Browser = { client: new Client(s.baseUrl) };
    const authorize = await begin(b, 'microsoft');
    const code = approve(authorize, 'microsoft', msClaims(newEmail(), WORK_TENANT));
    idp.grants.get(code)!.issuer = idp.issuer('microsoft', MS_PERSONAL_TENANT);
    const landing = await back(b, 'microsoft', { code, state: authorize.searchParams.get('state')! });
    expect(landing.searchParams.get('error')).toBe('token_invalid');
  });

  it('refuses an id token with the wrong nonce', async () => {
    const b: Browser = { client: new Client(s.baseUrl) };
    const authorize = await begin(b, 'google');
    const code = approve(authorize, 'google', googleClaims(newEmail()));
    idp.forceNonce = 'replayed-nonce';
    const landing = await back(b, 'google', { code, state: authorize.searchParams.get('state')! });
    expect(landing.searchParams.get('error')).toBe('token_invalid');
  });

  it('asks a user with two factor sign in for the second factor', async () => {
    const t = await signup(s);
    const setup = await t.client.ok('POST', '/v1/auth/totp/setup');
    await t.client.ok('POST', '/v1/auth/totp/enable', { code: totp(setup.secret) }, [200, 201]);

    const b: Browser = { client: new Client(s.baseUrl) };
    const landing = await socialRound(b, 'google', googleClaims(t.email));
    const step = await b.client.ok('POST', '/v1/auth/oauth/exchange', { code: landing.searchParams.get('code') }, 200);
    expect(step).toEqual({ totpRequired: true, ticket: expect.any(String) });
    expect(step.session).toBeUndefined();
    // Nothing is linked before the second factor.
    expect(await s.prisma.oAuthIdentity.count({ where: { userId: t.userId } })).toBe(0);

    const wrong = await b.client.post('/v1/auth/oauth/totp', { ticket: step.ticket, code: '000000' });
    expect(wrong.status).toBe(401);
    const done = await b.client.ok('POST', '/v1/auth/oauth/totp', { ticket: step.ticket, code: totp(setup.secret) }, 200);
    expect(done.user.id).toBe(t.userId);
    expect(done.session).toEqual(expect.any(String));
    expect(await s.prisma.oAuthIdentity.count({ where: { userId: t.userId } })).toBe(1);
    // The ticket is single use.
    expect((await b.client.post('/v1/auth/oauth/totp', { ticket: step.ticket, code: totp(setup.secret) })).status).toBe(400);
  });

  it('links and unlinks from Security, and never removes the last way to sign in', async () => {
    const b: Browser = { client: new Client(s.baseUrl) };
    const landing = await socialRound(b, 'google', googleClaims(newEmail()));
    const res = await b.client.ok('POST', '/v1/auth/oauth/exchange', { code: landing.searchParams.get('code') }, 200);
    b.client.token = res.session;
    const [google] = (await b.client.ok('GET', '/v1/account/identities')).data;
    const refused = await b.client.del(`/v1/account/identities/${google.id}`);
    expect(refused.status).toBe(409);
    expect(refused.text).toContain('last_sign_in_method');

    // Link a Microsoft work account (no verified email needed: the person is signed in).
    const { ticket } = await b.client.ok('POST', '/v1/auth/oauth/link-ticket', {}, 201);
    const linked = await socialRound(b, 'microsoft', msClaims('someone@contoso.example', WORK_TENANT), { intent: 'link', ticket, return: '/security' });
    expect(linked.searchParams.get('linked')).toBe('microsoft');
    expect(linked.searchParams.get('return')).toBe('/security');
    const ids = await b.client.ok('GET', '/v1/account/identities');
    expect(ids.data.map((i: { provider: string }) => i.provider).sort()).toEqual(['google', 'microsoft']);

    // The ticket is single use.
    const reuse = await begin(b, 'microsoft', { intent: 'link', ticket, return: '/security' });
    expect(reuse.searchParams.get('error')).toBe('link_session_invalid');

    await b.client.ok('DELETE', `/v1/account/identities/${google.id}`, undefined, 204);
    const ms = (await b.client.ok('GET', '/v1/account/identities')).data[0];
    expect((await b.client.del(`/v1/account/identities/${ms.id}`)).status).toBe(409);
    const audit = await s.prisma.auditLog.findMany({ where: { resource: `user:${res.user.id}`, action: 'user.identity_unlinked' } });
    expect(audit).toHaveLength(1);

    // An API token cannot start linking.
    const tok = await b.client.ok('POST', '/v1/tokens', { name: 'ci', scopes: ['servers:read'] }, 201);
    expect((await new Client(s.baseUrl, tok.token).post('/v1/auth/oauth/link-ticket', {})).status).toBe(403);
  });

  it('refuses a callback without the browser cookie or with the wrong one, and a reused state', async () => {
    const b: Browser = { client: new Client(s.baseUrl) };
    const authorize = await begin(b, 'google');
    const code = approve(authorize, 'google', googleClaims(newEmail()));
    const state = authorize.searchParams.get('state')!;
    // Another browser (an attacker's link) carries a different cookie: refused, and the state is spent.
    expect((await back(b, 'google', { code, state }, 'someone-elses-cookie')).searchParams.get('error')).toBe('state_invalid');
    expect((await back(b, 'google', { code, state })).searchParams.get('error')).toBe('state_invalid');

    const a2 = await begin(b, 'google');
    const c2 = approve(a2, 'google', googleClaims(newEmail()));
    expect((await back(b, 'google', { code: c2, state: a2.searchParams.get('state')! }, '')).searchParams.get('error')).toBe('state_invalid');
    expect((await back(b, 'google', { code: c2, state: 'made-up-state' })).searchParams.get('error')).toBe('state_invalid');
    // A state started for Google cannot finish at the Microsoft callback.
    const a3 = await begin(b, 'google');
    expect((await back(b, 'microsoft', { code: 'x', state: a3.searchParams.get('state')! })).searchParams.get('error')).toBe('state_invalid');
  });

  it('refuses a reused or unknown one time code', async () => {
    const b: Browser = { client: new Client(s.baseUrl) };
    const landing = await socialRound(b, 'google', googleClaims(newEmail()));
    const code = landing.searchParams.get('code')!;
    await b.client.ok('POST', '/v1/auth/oauth/exchange', { code }, 200);
    const again = await b.client.post('/v1/auth/oauth/exchange', { code });
    expect(again.status).toBe(400);
    expect(again.text).toContain('code_invalid');
    expect((await b.client.post('/v1/auth/oauth/exchange', { code: randomBytes(32).toString('base64url') })).status).toBe(400);
  });

  it('joins the inviting team instead of creating one', async () => {
    const owner = await signup(s);
    const email = newEmail();
    await owner.client.ok('POST', '/v1/team/invitations', { email, role: 'member' }, 201);
    const mail = s.outbox.find((m) => m.to === email)!;
    const invite = /invite\?token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];

    const b: Browser = { client: new Client(s.baseUrl) };
    // A different address than the invited one is refused.
    const wrong = await socialRound(b, 'google', googleClaims(newEmail()), { invite });
    expect(wrong.searchParams.get('error')).toBe('invite_email_mismatch');

    const landing = await socialRound(b, 'microsoft', msClaims(email, WORK_TENANT), { invite });
    const res = await b.client.ok('POST', '/v1/auth/oauth/exchange', { code: landing.searchParams.get('code') }, 200);
    expect(res.team.id).toBe(owner.teamId);
    expect(res.teams).toHaveLength(1);
    expect(res.returnTo).toBe('/team');
    expect(res.user.emailVerified).toBe(true); // the invitation link proved the address
    b.client.token = res.session;
    expect((await b.client.ok('GET', '/v1/account')).role).toBe('member');
  });
});
