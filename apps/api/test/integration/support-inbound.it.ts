import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { signup, sut, type Sut, type Team } from './harness';
import { RESEND_RECEIVED_EMAIL_URL, signSvix } from '../../src/modules/support/resend-inbound';

let s: Sut;
let team: Team;
const secret = process.env.RESEND_WEBHOOK_SECRET!;
/** Emails the stubbed Resend Receiving API serves, by id. */
const received = new Map<string, { from: string; to: string[]; subject: string; text: string | null; html: string | null }>();
const fetched: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  s = await sut();
  team = await signup(s);
  // Only calls to Resend are stubbed; everything else, including the calls to the API, goes out.
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith('https://api.resend.com/')) return realFetch(input, init);
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${process.env.MAIL_API_KEY}`);
    const id = decodeURIComponent(url.slice(RESEND_RECEIVED_EMAIL_URL.length + 1));
    fetched.push(id);
    const email = received.get(id);
    if (!email) return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
    return new Response(JSON.stringify({ object: 'email', id, ...email }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

async function deliver(event: unknown, opts: { svixId?: string; sign?: string; ts?: number } = {}) {
  const body = JSON.stringify(event);
  const id = opts.svixId ?? `msg_${randomUUID()}`;
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const r = await realFetch(`${s.baseUrl}/v1/support/inbound/resend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': signSvix(opts.sign ?? secret, id, ts, body) },
    body,
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as Record<string, any> };
}

function receivedEvent(emailId: string, to = ['Progrid Support <Support@Progrid.sa>']) {
  return { type: 'email.received', created_at: new Date().toISOString(), data: { email_id: emailId, from: team.email, to, subject: 'ignored', message_id: `<${emailId}@mail.example>`, attachments: [] } };
}

describe('support inbound via Resend', () => {
  it('opens a ticket once per email, threads replies and rejects bad signatures', async () => {
    const emailId = randomUUID();
    received.set(emailId, { from: `Customer <${team.email.toUpperCase()}>`, to: ['support@progrid.sa'], subject: 'Server will not boot', text: null, html: '<p>My server &amp; its disk are stuck.</p>' });

    const first = await deliver(receivedEvent(emailId));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ accepted: true, action: 'created' });
    const ticket = await s.prisma.ticket.findUniqueOrThrow({ where: { id: first.body.ticketId }, include: { messages: true } });
    expect(ticket.teamId).toBe(team.teamId);
    expect(ticket.subject).toBe('Server will not boot');
    expect(ticket.messages.map((m) => m.body)).toEqual(['My server & its disk are stuck.']);

    // Resend retries the same email (same svix-id, or a fresh one): no second ticket.
    const again = await deliver(receivedEvent(emailId));
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ ignored: true, reason: 'duplicate' });
    expect(await s.prisma.ticket.count({ where: { teamId: team.teamId } })).toBe(1);

    // A reply on the ticket lands on it, without the quoted history.
    const replyId = randomUUID();
    received.set(replyId, { from: team.email, to: ['support@progrid.sa'], subject: `Re: [#${ticket.number}] Server will not boot`, html: null, text: `It boots now, thanks.\n\nOn Mon, 29 Sep 2026, Progrid <support@progrid.sa> wrote:\n> Try a restart.` });
    const reply = await deliver(receivedEvent(replyId));
    expect(reply.body).toMatchObject({ accepted: true, action: 'replied', ticketId: ticket.id });
    const messages = await s.prisma.ticketMessage.findMany({ where: { ticketId: ticket.id }, orderBy: { createdAt: 'asc' } });
    expect(messages.at(-1)?.body).toBe('It boots now, thanks.');

    // Bad signature, stale timestamp: 401 and Resend is never asked.
    const before = fetched.length;
    const other = 'whsec_' + Buffer.from('not the webhook secret at all!!').toString('base64');
    expect((await deliver(receivedEvent(randomUUID()), { sign: other })).status).toBe(401);
    expect((await deliver(receivedEvent(randomUUID()), { ts: Math.floor(Date.now() / 1000) - 600 })).status).toBe(401);
    expect(fetched.length).toBe(before);

    // Other events and other inboxes are acknowledged and ignored.
    expect((await deliver({ type: 'email.delivered', data: { email_id: randomUUID() } })).body).toMatchObject({ ignored: true });
    expect((await deliver(receivedEvent(randomUUID(), ['sales@progrid.sa']))).body).toMatchObject({ ignored: true, reason: 'not_support_inbox' });
    expect(fetched.length).toBe(before);
    expect(await s.prisma.ticket.count({ where: { teamId: team.teamId } })).toBe(1);
  });

  it('lets Resend retry when the email cannot be fetched', async () => {
    const emailId = randomUUID();
    const r = await deliver(receivedEvent(emailId));
    expect(r.status).toBe(502);
    received.set(emailId, { from: team.email, to: ['support@progrid.sa'], subject: 'Billing question', text: 'Where is my invoice?', html: null });
    const retry = await deliver(receivedEvent(emailId));
    expect(retry.body).toMatchObject({ accepted: true, action: 'created' });
  });
});
