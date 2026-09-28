import type { PrismaClient } from '@prisma/client';
import { open, seal } from '../../../common/crypto/secretbox';
import { loadConfig } from '../../../config/config';

export type SecretValues = Record<string, string>;

/**
 * Credentials the gateway injects into terminal sessions (sudo passwords, database users ...).
 * Refs look like `assets/<assetId>`. No /ops/v1 endpoint ever returns values: only the gateway
 * reads them, through POST /internal/gateway/secrets for a live session on that asset.
 */
export interface SecretStore {
  readonly name: 'local' | 'vault' | 'infisical';
  get(ref: string): Promise<SecretValues>;
  /** Replaces every value under the ref. */
  put(ref: string, values: SecretValues): Promise<void>;
  delete(ref: string): Promise<void>;
}

export const assetSecretRef = (assetId: string) => `assets/${assetId}`;

type Fetch = typeof fetch;

/** Development and tests: one sealed JSON document per ref in prgd_ops_secrets. */
export class LocalSecretStore implements SecretStore {
  readonly name = 'local' as const;
  constructor(private readonly prisma: Pick<PrismaClient, 'opsSecret'>) {}

  async get(ref: string) {
    const row = await this.prisma.opsSecret.findUnique({ where: { ref } });
    return row ? (JSON.parse(open(row.values)) as SecretValues) : {};
  }

  async put(ref: string, values: SecretValues) {
    const sealed = seal(JSON.stringify(values));
    await this.prisma.opsSecret.upsert({ where: { ref }, create: { ref, values: sealed }, update: { values: sealed } });
  }

  async delete(ref: string) {
    await this.prisma.opsSecret.deleteMany({ where: { ref } });
  }
}

/** HashiCorp Vault KV version 2 at PRGD_VAULT_MOUNT (token auth, PRGD_VAULT_TOKEN). */
export class VaultSecretStore implements SecretStore {
  readonly name = 'vault' as const;
  constructor(private readonly cfg: { addr: string; token: string; mount: string }, private readonly http: Fetch = fetch) {}

  private url(kind: 'data' | 'metadata', ref: string) {
    return `${this.cfg.addr.replace(/\/$/, '')}/v1/${this.cfg.mount}/${kind}/${ref.split('/').map(encodeURIComponent).join('/')}`;
  }

  private async call(method: string, url: string, body?: unknown) {
    const r = await this.http(url, { method, headers: { 'X-Vault-Token': this.cfg.token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`vault ${method} ${url.replace(/\/v1\/.*/, '/v1/...')}: ${r.status}`);
    const text = await r.text();
    return text ? JSON.parse(text) : {};
  }

  async get(ref: string) {
    const body = (await this.call('GET', this.url('data', ref))) as { data?: { data?: SecretValues } } | null;
    return body?.data?.data ?? {};
  }

  async put(ref: string, values: SecretValues) {
    await this.call('POST', this.url('data', ref), { data: values });
  }

  async delete(ref: string) {
    await this.call('DELETE', this.url('metadata', ref));
  }
}

/** Infisical (API v3 raw secrets) with a machine identity token; ref `assets/x` is the folder /assets/x. */
export class InfisicalSecretStore implements SecretStore {
  readonly name = 'infisical' as const;
  constructor(private readonly cfg: { url: string; token: string; project: string; env: string }, private readonly http: Fetch = fetch) {}

  private async call(method: string, path: string, body?: Record<string, unknown>) {
    const r = await this.http(`${this.cfg.url.replace(/\/$/, '')}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.cfg.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`infisical ${method} ${path.split('?')[0]}: ${r.status}`);
    return (await r.json()) as unknown;
  }

  private scope(ref: string) {
    return { workspaceId: this.cfg.project, environment: this.cfg.env, secretPath: `/${ref}` };
  }

  async get(ref: string) {
    const q = new URLSearchParams({ ...this.scope(ref) });
    const body = (await this.call('GET', `/api/v3/secrets/raw?${q}`)) as { secrets?: { secretKey: string; secretValue: string }[] } | null;
    return Object.fromEntries((body?.secrets ?? []).map((x) => [x.secretKey, x.secretValue]));
  }

  async put(ref: string, values: SecretValues) {
    const current = await this.get(ref);
    for (const [key, value] of Object.entries(values)) {
      const method = key in current ? 'PATCH' : 'POST';
      await this.call(method, `/api/v3/secrets/raw/${encodeURIComponent(key)}`, { ...this.scope(ref), secretValue: value, type: 'shared' });
    }
    for (const key of Object.keys(current).filter((k) => !(k in values))) {
      await this.call('DELETE', `/api/v3/secrets/raw/${encodeURIComponent(key)}`, { ...this.scope(ref), type: 'shared' });
    }
  }

  async delete(ref: string) {
    await this.put(ref, {});
  }
}

export function createSecretStore(prisma: Pick<PrismaClient, 'opsSecret'>): SecretStore {
  const c = loadConfig();
  if (c.PRGD_SECRET_STORE === 'vault') {
    if (!c.PRGD_VAULT_ADDR || !c.PRGD_VAULT_TOKEN) throw new Error('PRGD_VAULT_ADDR and PRGD_VAULT_TOKEN are required when PRGD_SECRET_STORE=vault');
    return new VaultSecretStore({ addr: c.PRGD_VAULT_ADDR, token: c.PRGD_VAULT_TOKEN, mount: c.PRGD_VAULT_MOUNT });
  }
  if (c.PRGD_SECRET_STORE === 'infisical') {
    if (!c.PRGD_INFISICAL_TOKEN || !c.PRGD_INFISICAL_PROJECT) throw new Error('PRGD_INFISICAL_TOKEN and PRGD_INFISICAL_PROJECT are required when PRGD_SECRET_STORE=infisical');
    return new InfisicalSecretStore({ url: c.PRGD_INFISICAL_URL, token: c.PRGD_INFISICAL_TOKEN, project: c.PRGD_INFISICAL_PROJECT, env: c.PRGD_INFISICAL_ENV });
  }
  return new LocalSecretStore(prisma);
}
