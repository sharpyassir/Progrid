import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { randomBytes } from 'node:crypto';
import { DeployService } from '../../src/modules/deploy/deploy.service';
import { readyTeam, sut, waitFor, waitStatus, type Sut } from './harness';

let s: Sut;
beforeAll(async () => {
  s = await sut();
});

/**
 * Stub DNS for the domain ownership check: TXT records the test publishes, nothing else
 * resolves. The app looks names up through node:dns/promises.
 */
const dns = createRequire(__filename)('node:dns/promises') as typeof import('node:dns/promises');
const real = { resolveTxt: dns.resolveTxt, resolveCname: dns.resolveCname };
const txt = new Map<string, string[][]>();
function stubDns() {
  const missing = (name: string) => Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND', hostname: name });
  Object.assign(dns, {
    resolveTxt: async (name: string) => {
      const r = txt.get(name);
      if (!r) throw missing(name);
      return r;
    },
    resolveCname: async (name: string) => {
      throw missing(name);
    },
  });
  syncBuiltinESMExports();
}
afterEach(() => {
  Object.assign(dns, real);
  syncBuiltinESMExports();
  txt.clear();
});

describe('App Platform', () => {
  it('deploys an app on a shared host and serves a custom domain only after the TXT check passes', async () => {
    stubDns();
    const c = (await readyTeam(s)).client;
    const name = `web-${randomBytes(3).toString('hex')}`;
    const created = await c.ok('POST', '/v1/app-platform/apps', { name, repoUrl: 'https://github.com/example/hello-node', port: 8080, env: { GREETING: 'hi' } }, 202);
    expect(created.status).toBe('creating');
    const app = await waitStatus<any>(c, `/v1/app-platform/apps/${created.id}`, 'live', 120_000);
    expect(app.url).toBe(`https://${name}.apps.progrid.sa`);
    expect(app.deploys[0].status).toBe('live');
    expect(app.lastCommit).toMatch(/^[0-9a-f]{40}$/);

    // The host became usable only once its agent reported Docker and Caddy running.
    const row = await s.prisma.platformApp.findUniqueOrThrow({ where: { id: app.id }, include: { host: true } });
    expect(row.host!.status).toBe('active');
    expect(row.host!.readyAt).not.toBeNull();
    const host = await s.agents.inspect(row.host!.serverId);
    expect(host!.kind).toBe('app');
    expect(host!.last!.apps[0].env).toEqual({ GREETING: 'hi' });
    expect(host!.st.caddySites).toEqual([{ app: app.id, hostnames: [`${name}.apps.progrid.sa`] }]);

    const logs = await c.ok('GET', `/v1/app-platform/apps/${app.id}/logs?type=build`);
    expect(logs.live).toBe(true);
    expect(logs.log).toContain('=== live ===');

    // Custom domain: listed with its token, refused while no record exists, not in the Caddyfile.
    const domain = `shop-${randomBytes(3).toString('hex')}.example.com`;
    const withDomain = await c.ok('POST', `/v1/app-platform/apps/${app.id}/domains`, { domain }, 200);
    const d = withDomain.domains.find((x: { domain: string }) => x.domain === domain);
    expect(d.verified).toBe(false);
    expect(d.verification.txt.name).toBe(`_progrid-verify.${domain}`);
    const refused = await c.post(`/v1/app-platform/apps/${app.id}/domains/${domain}/verify`);
    expect(refused.status).toBe(409);
    expect(refused.text).toContain(`_progrid-verify.${domain}`);
    expect((await s.agents.inspect(row.host!.serverId))!.st.caddySites[0].hostnames).not.toContain(domain);

    // A wrong token does not count either.
    txt.set(`_progrid-verify.${domain}`, [['progrid-not-the-token']]);
    expect((await c.post(`/v1/app-platform/apps/${app.id}/domains/${domain}/verify`)).status).toBe(409);

    txt.set(`_progrid-verify.${domain}`, [[d.verification.txt.value]]);
    const verified = await c.ok('POST', `/v1/app-platform/apps/${app.id}/domains/${domain}/verify`, {}, 200);
    expect(verified.domains.find((x: { domain: string }) => x.domain === domain).verified).toBe(true);
    const sites = (await s.agents.inspect(row.host!.serverId))!.st.caddySites;
    expect(sites[0].hostnames).toEqual([`${name}.apps.progrid.sa`, domain]);

    // Stop takes the app out of Caddy; start puts it back without a build.
    expect((await c.ok('POST', `/v1/app-platform/apps/${app.id}/stop`, {}, 200)).status).toBe('stopped');
    expect((await s.agents.inspect(row.host!.serverId))!.st.caddySites).toEqual([]);
    expect((await c.ok('POST', `/v1/app-platform/apps/${app.id}/start`, {}, 200)).status).toBe('live');
    expect((await s.agents.inspect(row.host!.serverId))!.st.caddySites.map((x: { app: string }) => x.app)).toEqual([app.id]);

    // A redeploy builds again and ends live with a second deploy.
    await c.ok('POST', `/v1/app-platform/apps/${app.id}/deploy`, {}, 202);
    await waitFor(async () => {
      const r = await c.ok('GET', `/v1/app-platform/apps/${app.id}`);
      return r.status === 'live' && r.deploys.length === 2 && r.deploys[0].status === 'live' ? r : null;
    }, { what: 'the redeploy to be live', timeoutMs: 60_000 });

    await c.ok('DELETE', `/v1/app-platform/apps/${app.id}`, undefined, 202);
    await waitFor(async () => (await c.get(`/v1/app-platform/apps/${app.id}`)).status === 404, { what: 'app to be deleted', timeoutMs: 60_000 });
    expect((await s.agents.inspect(row.host!.serverId))!.st.apps[app.id]).toBeUndefined();
  });

  it('marks a deploy that fails to build as failed and keeps the previous state', async () => {
    const c = (await readyTeam(s)).client;
    const created = await c.ok('POST', '/v1/app-platform/apps', { name: `bad-${randomBytes(3).toString('hex')}`, repoUrl: 'https://github.com/example/broken-app' }, 202);
    const now = await waitFor(async () => {
      const r = await c.ok('GET', `/v1/app-platform/apps/${created.id}`);
      return ['failed', 'live'].includes(r.status) ? r : null;
    }, { what: 'the first build to finish', timeoutMs: 120_000 });
    expect(now.status).toBe('failed');
    expect(now.statusMessage).toContain('first build failed');
    expect(now.deploys[0].status).toBe('failed');
    const deploys = await c.ok('GET', `/v1/app-platform/apps/${created.id}/deploys`);
    expect(deploys.data[0].log).toContain('no Dockerfile');
  });
});

describe('Git Deploy', () => {
  it('builds on the server at boot and redeploys through the agent', async () => {
    const c = (await readyTeam(s)).client;
    const d = await c.ok('POST', '/v1/deploys', { repoUrl: 'https://github.com/example/site', name: `site-${randomBytes(2).toString('hex')}` }, 202);
    expect(d.webhook.secret).toMatch(/^whsec_/);
    await waitStatus(c, `/v1/servers/${d.serverId}`, 'active');
    const deploys = s.get(DeployService);
    await waitFor(async () => {
      await deploys.refreshStatus(d.id);
      return (await c.ok('GET', `/v1/deploys/${d.id}`)).status === 'live';
    }, { what: 'first deploy to be live', timeoutMs: 30_000 });
    const first = await c.ok('GET', `/v1/deploys/${d.id}`);

    await c.ok('POST', `/v1/deploys/${d.id}/redeploy`, {}, 202);
    expect((await c.ok('GET', `/v1/deploys/${d.id}`)).status).toBe('deploying');
    await waitFor(async () => (await c.ok('GET', `/v1/deploys/${d.id}/logs`)).status === 'live', { what: 'redeploy to be live', timeoutMs: 30_000 });
    const logs = await c.ok('GET', `/v1/deploys/${d.id}/logs`);
    expect(logs.live).toBe(true);
    expect(logs.log.match(/=== deploy /g)).toHaveLength(2);
    expect(logs.commit).not.toBe(first.lastCommit);
  });
});
