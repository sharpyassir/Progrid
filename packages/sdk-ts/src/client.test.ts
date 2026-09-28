import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prgd, PrgdError } from './index.js';

/** A fetch stub that records requests and answers from a script. */
function stub(answers: { status?: number; body: unknown }[]) {
  const calls: { method: string; url: string; headers: Record<string, string>; body?: string }[] = [];
  const f = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const a = answers.shift() ?? { body: {} };
    calls.push({ method: init?.method ?? 'GET', url: String(input), headers: init?.headers as Record<string, string>, body: init?.body as string | undefined });
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
}

test('sends bearer token, idempotency key on writes, project scoping', async () => {
  const { f, calls } = stub([{ body: { data: [] } }, { body: { id: 'srv_1', status: 'new' } }]);
  const prgd = new Prgd({ token: 'prgd_x', baseUrl: 'http://api.test/v1', fetch: f, project: 'staging' });
  await prgd.servers.list();
  await prgd.servers.create({ name: 'web-1', size: 's-1vcpu-1gb', image: 'ubuntu-24-04' });
  assert.equal(calls[0].url, 'http://api.test/v1/servers?project=staging');
  assert.equal(calls[0].headers.authorization, 'Bearer prgd_x');
  assert.equal(calls[0].headers['idempotency-key'], undefined);
  assert.equal(calls[1].method, 'POST');
  assert.ok(calls[1].headers['idempotency-key']);
  assert.deepEqual(JSON.parse(calls[1].body!), { project: 'staging', name: 'web-1', size: 's-1vcpu-1gb', image: 'ubuntu-24-04' });
});

test('maps API errors to PrgdError with code and details', async () => {
  const { f } = stub([{ status: 403, body: { error: { code: 'approval_required', message: 'A team owner must approve this first', details: { approvalId: 'apr_1' } } } }]);
  const prgd = new Prgd({ token: 'prgd_x', baseUrl: 'http://api.test', fetch: f });
  await assert.rejects(prgd.servers.delete('srv_1'), (e: unknown) => {
    assert.ok(e instanceof PrgdError);
    assert.equal(e.status, 403);
    assert.equal(e.code, 'approval_required');
    assert.ok(e.needsApproval);
    assert.equal(e.details?.approvalId, 'apr_1');
    return true;
  });
});

test('waitUntilActive polls until active and throws on failed', async () => {
  const ok = stub([{ body: { id: 's', status: 'provisioning' } }, { body: { id: 's', status: 'active', networks: { v4: [{ ipAddress: '203.0.113.9' }] } } }]);
  const prgd = new Prgd({ token: 't', baseUrl: 'http://api.test', fetch: ok.f });
  const s = await prgd.servers.waitUntilActive('s', { intervalMs: 1 });
  assert.equal(s.status, 'active');
  assert.equal(ok.calls.length, 2);
  const bad = stub([{ body: { id: 's', status: 'failed', statusMessage: 'No capacity' } }]);
  const prgd2 = new Prgd({ token: 't', baseUrl: 'http://api.test', fetch: bad.f });
  await assert.rejects(prgd2.servers.waitUntilActive('s'), /No capacity/);
});
