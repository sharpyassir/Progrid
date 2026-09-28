import { describe, expect, it } from 'vitest';
import { InfisicalSecretStore, VaultSecretStore } from './secret-store';

function recorder(respond: (url: string, init: RequestInit) => unknown) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const http = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const out = respond(url, init);
    return new Response(out === undefined ? '' : JSON.stringify(out), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, http };
}

describe('secret stores', () => {
  it('reads and writes Vault KV v2 under the mount', async () => {
    const r = recorder((url, init) => (init.method === 'GET' ? { data: { data: { sudo_password: 'x' } } } : {}));
    const vault = new VaultSecretStore({ addr: 'https://vault.internal:8200/', token: 'hvs.token', mount: 'prgd' }, r.http);
    expect(await vault.get('assets/a1')).toEqual({ sudo_password: 'x' });
    await vault.put('assets/a1', { sudo_password: 'y' });
    await vault.delete('assets/a1');
    expect(r.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://vault.internal:8200/v1/prgd/data/assets/a1',
      'POST https://vault.internal:8200/v1/prgd/data/assets/a1',
      'DELETE https://vault.internal:8200/v1/prgd/metadata/assets/a1',
    ]);
    expect(r.calls[0].headers['X-Vault-Token']).toBe('hvs.token');
    expect(r.calls[1].body).toEqual({ data: { sudo_password: 'y' } });
  });

  it('reads Infisical raw secrets from the asset folder and writes key by key', async () => {
    const r = recorder((url, init) => (init.method === 'GET' ? { secrets: [{ secretKey: 'old_key', secretValue: 'o' }, { secretKey: 'sudo_password', secretValue: 'x' }] } : {}));
    const store = new InfisicalSecretStore({ url: 'https://infisical.internal', token: 'st.token', project: 'proj-1', env: 'prod' }, r.http);
    expect(await store.get('assets/a1')).toEqual({ old_key: 'o', sudo_password: 'x' });
    expect(r.calls[0].url).toBe('https://infisical.internal/api/v3/secrets/raw?workspaceId=proj-1&environment=prod&secretPath=%2Fassets%2Fa1');
    expect(r.calls[0].headers.authorization).toBe('Bearer st.token');
    r.calls.length = 0;
    await store.put('assets/a1', { sudo_password: 'y', db_password: 'z' });
    expect(r.calls.map((c) => `${c.method} ${c.url.replace('https://infisical.internal', '')}`)).toEqual([
      'GET /api/v3/secrets/raw?workspaceId=proj-1&environment=prod&secretPath=%2Fassets%2Fa1',
      'PATCH /api/v3/secrets/raw/sudo_password',
      'POST /api/v3/secrets/raw/db_password',
      'DELETE /api/v3/secrets/raw/old_key',
    ]);
    expect(r.calls[1].body).toMatchObject({ workspaceId: 'proj-1', environment: 'prod', secretPath: '/assets/a1', secretValue: 'y', type: 'shared' });
  });
});
