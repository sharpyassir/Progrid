import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { loadConfig } from '../../config/config';
import { emailTrusted, issuerValid, type ProviderAccount, type ProviderId } from './linking';

export interface ProviderSettings {
  id: ProviderId;
  clientId: string;
  clientSecret: string;
  /** OpenID Connect discovery document. */
  discoveryUrl: string;
  /** Microsoft only: the configured directory (common, organizations, consumers or a tenant id). */
  tenant: string;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const DISCOVERY_TTL_MS = 6 * 3600_000;
export const OIDC_SCOPES = 'openid email profile';

/**
 * Google and Microsoft as OpenID Connect providers: discovery, the authorization URL, the code
 * exchange and id token verification against the provider's published keys. Discovery
 * documents and key sets are cached in memory; jose refetches a key set when a token names a
 * key it has not seen (key rotation).
 */
@Injectable()
export class OidcProviders {
  private readonly overrides = new Map<ProviderId, Partial<ProviderSettings>>();
  private readonly discovery = new Map<string, { doc: Discovery; at: number }>();
  private readonly jwks = new Map<string, JWTVerifyGetKey>();

  /** Settings for a provider, or null when it is not configured. */
  settings(id: string): ProviderSettings | null {
    const cfg = loadConfig();
    let s: Partial<ProviderSettings> | null = null;
    if (id === 'google') s = { id, clientId: cfg.GOOGLE_CLIENT_ID, clientSecret: cfg.GOOGLE_CLIENT_SECRET, discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration', tenant: '' };
    if (id === 'microsoft') {
      const tenant = cfg.MICROSOFT_TENANT;
      s = { id, clientId: cfg.MICROSOFT_CLIENT_ID, clientSecret: cfg.MICROSOFT_CLIENT_SECRET, discoveryUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/v2.0/.well-known/openid-configuration`, tenant };
    }
    if (!s) return null;
    const merged = { ...s, ...this.overrides.get(id as ProviderId) } as ProviderSettings;
    return merged.clientId && merged.clientSecret ? merged : null;
  }

  configured(): ProviderId[] {
    return (['google', 'microsoft'] as const).filter((p) => this.settings(p));
  }

  /**
   * Tests only: point a provider at a local OpenID Connect server. Not reachable from the API.
   * Passing null removes the override.
   */
  override(id: ProviderId, s: Partial<ProviderSettings> | null) {
    if (s) this.overrides.set(id, s);
    else this.overrides.delete(id);
    this.discovery.clear();
    this.jwks.clear();
  }

  redirectUri(id: ProviderId) {
    const cfg = loadConfig();
    return `${(cfg.OAUTH_REDIRECT_BASE ?? cfg.PUBLIC_API_URL).replace(/\/+$/, '')}/v1/auth/oauth/${id}/callback`;
  }

  async authorizationUrl(s: ProviderSettings, p: { state: string; nonce: string; codeChallenge: string; loginHint?: string }) {
    const d = await this.discover(s);
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: s.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri(s.id),
      scope: OIDC_SCOPES,
      state: p.state,
      nonce: p.nonce,
      code_challenge: p.codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
      ...(p.loginHint ? { login_hint: p.loginHint } : {}),
    }).toString();
    return url.toString();
  }

  /** Exchanges the authorization code (with the PKCE verifier) and verifies the id token. */
  async redeem(s: ProviderSettings, code: string, codeVerifier: string, nonce: string): Promise<{ account: ProviderAccount; claims: JWTPayload }> {
    const d = await this.discover(s);
    const res = await fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri(s.id), client_id: s.clientId, client_secret: s.clientSecret, code_verifier: codeVerifier }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
    if (!res.ok || !body.id_token) throw new Error(`token endpoint answered ${res.status}: ${body.error ?? ''} ${body.error_description ?? ''}`.trim());
    const claims = await this.verifyIdToken(s, d, body.id_token, nonce);
    return { account: toAccount(s.id, claims), claims };
  }

  async verifyIdToken(s: ProviderSettings, d: Discovery, idToken: string, nonce: string): Promise<JWTPayload> {
    let keys = this.jwks.get(d.jwks_uri);
    if (!keys) this.jwks.set(d.jwks_uri, (keys = createRemoteJWKSet(new URL(d.jwks_uri), { cacheMaxAge: 6 * 3600_000, cooldownDuration: 30_000 })));
    // The issuer is checked below: Microsoft's multi tenant issuer depends on the token's tid.
    const { payload } = await jwtVerify(idToken, keys, { audience: s.clientId, algorithms: ['RS256'], clockTolerance: 60, requiredClaims: ['sub', 'iss', 'exp', 'iat'] });
    if (!issuerValid(s.id, d.issuer, payload, s.tenant)) throw new Error(`id token issuer ${String(payload.iss)} is not accepted`);
    if (payload.nonce !== nonce) throw new Error('id token nonce does not match');
    return payload;
  }

  private async discover(s: ProviderSettings): Promise<Discovery> {
    const hit = this.discovery.get(s.discoveryUrl);
    if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit.doc;
    const res = await fetch(s.discoveryUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`discovery ${s.discoveryUrl} answered ${res.status}`);
    const doc = (await res.json()) as Discovery;
    if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) throw new Error(`discovery ${s.discoveryUrl} is incomplete`);
    this.discovery.set(s.discoveryUrl, { doc, at: Date.now() });
    return doc;
  }
}

function toAccount(provider: ProviderId, c: JWTPayload): ProviderAccount {
  const email = typeof c.email === 'string' && c.email.includes('@') ? c.email.trim().toLowerCase() : null;
  const given = typeof c.given_name === 'string' ? c.given_name : '';
  const family = typeof c.family_name === 'string' ? c.family_name : '';
  const name = (typeof c.name === 'string' && c.name.trim()) || `${given} ${family}`.trim() || (email ? email.split('@')[0] : 'New user');
  return {
    provider,
    subject: String(c.sub),
    email,
    emailVerified: email !== null && emailTrusted(provider, c as Record<string, unknown>),
    name: name.slice(0, 80),
    tenantId: provider === 'microsoft' && typeof c.tid === 'string' ? c.tid : null,
  };
}
