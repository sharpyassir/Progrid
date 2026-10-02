import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { checkUrl, hostMatches, isBlockedAddress, makePolicy, NetBlockedError, resolveSafeHost, safeFetch, type Resolver } from './guard';

/** A resolver from a fixed table, so tests never touch real DNS. */
const table = (map: Record<string, string[]>): Resolver => async (host) => (map[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('blocked address ranges', () => {
  it.each([
    '10.0.0.1', '10.9.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.1', '127.0.0.1', '127.8.8.8', '169.254.169.254', '100.64.0.1', '100.127.255.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:a9fe:a9fe', '64:ff9b::10.0.0.1',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it('treats garbage as blocked', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });
});

describe('host resolution', () => {
  const policy = makePolicy('', table({ 'api.example.com': ['93.184.216.34'], 'rebind.example.com': ['93.184.216.34', '10.0.0.5'], 'meta.example.com': ['169.254.169.254'], 'v6.example.com': ['::1'] }));

  it('allows hosts whose every address is public', async () => {
    expect((await resolveSafeHost('api.example.com', policy)).address).toBe('93.184.216.34');
  });

  it('blocks a host when any address is private (DNS answers that mix in a private IP)', async () => {
    await expect(resolveSafeHost('rebind.example.com', policy)).rejects.toThrow(/private or reserved address \(10\.0\.0\.5\)/);
    await expect(resolveSafeHost('meta.example.com', policy)).rejects.toThrow(NetBlockedError);
    await expect(resolveSafeHost('v6.example.com', policy)).rejects.toThrow(NetBlockedError);
  });

  it('blocks local names, IP literals and names that do not resolve', async () => {
    await expect(resolveSafeHost('localhost', policy)).rejects.toThrow(/local host name/);
    await expect(resolveSafeHost('db.internal', policy)).rejects.toThrow(/local host name/);
    await expect(resolveSafeHost('10.0.0.1', policy)).rejects.toThrow(/private/);
    await expect(resolveSafeHost('[::1]', policy)).rejects.toThrow(/private/);
    await expect(resolveSafeHost('nowhere.example.com', policy)).rejects.toThrow(/does not resolve/);
  });

  it('lets the admin allowlist open specific ranges and hosts', async () => {
    const open = makePolicy('10.9.0.0/24, db.internal', table({ 'db.internal': ['10.20.0.4'], 'peer.example.com': ['10.9.0.7'] }));
    expect((await resolveSafeHost('peer.example.com', open)).address).toBe('10.9.0.7');
    expect((await resolveSafeHost('db.internal', open)).address).toBe('10.20.0.4');
    await expect(resolveSafeHost('10.9.1.1', open)).rejects.toThrow(NetBlockedError);
  });
});

describe('URL checks', () => {
  it('accepts only http and https without credentials', () => {
    expect(() => checkUrl('ftp://example.com/x')).toThrow(/only http and https/);
    expect(() => checkUrl('file:///etc/passwd')).toThrow(/only http and https/);
    expect(() => checkUrl('https://user:pw@example.com/')).toThrow(/credentials/);
    expect(() => checkUrl('not a url')).toThrow(/valid URL/);
    expect(checkUrl('https://example.com/a').hostname).toBe('example.com');
  });

  it('enforces allowed hosts with wildcards', () => {
    expect(hostMatches('api.example.com', ['*.example.com'])).toBe(true);
    expect(hostMatches('example.com', ['*.example.com'])).toBe(false);
    expect(hostMatches('evil-example.com', ['*.example.com'])).toBe(false);
    expect(hostMatches('anything.org', [])).toBe(true);
    expect(() => checkUrl('https://evil.com/', ['api.example.com'])).toThrow(/allowed hosts/);
  });
});

describe('safeFetch', () => {
  let server: Server;
  let base: string;
  let port: number;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/ok') {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ hello: 'world', auth: req.headers.authorization ?? null }));
      }
      if (req.url === '/to-private') {
        res.statusCode = 302;
        res.setHeader('location', 'http://internal.example.com/secret');
        return res.end();
      }
      if (req.url === '/to-metadata') {
        res.statusCode = 301;
        res.setHeader('location', 'http://169.254.169.254/latest/meta-data/');
        return res.end();
      }
      if (req.url?.startsWith('/loop')) {
        res.statusCode = 302;
        res.setHeader('location', `/loop${Number(req.url.slice(5) || 0) + 1}`);
        return res.end();
      }
      if (req.url === '/big') return res.end('x'.repeat(5000));
      if (req.url === '/slow') return void setTimeout(() => res.end('late'), 2000);
      if (req.url === '/hop') {
        res.statusCode = 302;
        res.setHeader('location', `http://other.example.com:${port}/ok`);
        return res.end();
      }
      res.statusCode = 404;
      res.end('nope');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
    base = `http://local.test:${port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  // local.test resolves to the loopback test server, which only the allowlist opens.
  const resolver = table({ 'local.test': ['127.0.0.1'], 'internal.example.com': ['10.1.2.3'], 'other.example.com': ['127.0.0.1'] });
  const allowed = makePolicy('local.test,other.example.com', resolver);

  it('blocks a host that resolves to loopback when it is not allowlisted', async () => {
    await expect(safeFetch(`${base}/ok`, {}, { policy: makePolicy('', resolver) })).rejects.toThrow(/private or reserved/);
  });

  it('blocks IP literals directly', async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/ok`, {}, { policy: makePolicy('', resolver) })).rejects.toThrow(/private or reserved/);
    await expect(safeFetch('http://169.254.169.254/latest', {}, { policy: allowed })).rejects.toThrow(/private or reserved/);
  });

  it('fetches an allowed host', async () => {
    const res = await safeFetch(`${base}/ok`, { headers: { authorization: 'Bearer t' } }, { policy: allowed });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ hello: 'world', auth: 'Bearer t' });
  });

  it('re-checks every redirect hop against private ranges', async () => {
    await expect(safeFetch(`${base}/to-private`, {}, { policy: allowed })).rejects.toThrow(/private or reserved/);
    await expect(safeFetch(`${base}/to-metadata`, {}, { policy: allowed })).rejects.toThrow(/private or reserved/);
  });

  it('stops after 3 redirects', async () => {
    await expect(safeFetch(`${base}/loop0`, {}, { policy: allowed })).rejects.toThrow(/more than 3 redirects/);
  });

  it('enforces allowed hosts on redirects and drops credentials across hosts', async () => {
    await expect(safeFetch(`${base}/hop`, {}, { policy: allowed, allowedHosts: ['local.test'] })).rejects.toThrow(/allowed hosts/);
    const res = await safeFetch(`${base}/hop`, { headers: { authorization: 'Bearer t' } }, { policy: allowed });
    expect(JSON.parse(res.body).auth).toBeNull();
  });

  it('caps the response size', async () => {
    const res = await safeFetch(`${base}/big`, {}, { policy: allowed, maxBytes: 1000 });
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBe(1000);
  });

  it('times out', async () => {
    await expect(safeFetch(`${base}/slow`, {}, { policy: allowed, timeoutMs: 300 })).rejects.toThrow(/timed out/);
  });
});
