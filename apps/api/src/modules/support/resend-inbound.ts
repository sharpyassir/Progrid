import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Helpers for Resend inbound receiving (POST /v1/support/inbound/resend).
 *
 * Resend posts an `email.received` webhook that carries only metadata; the body is fetched from
 * the Receiving API. Webhooks are signed with Svix (Standard Webhooks).
 */

/** Receiving API: GET {base}/{email_id} returns { from, to, subject, text, html, ... }. */
export const RESEND_RECEIVED_EMAIL_URL = 'https://api.resend.com/emails/receiving';

/** Signatures older (or further in the future) than this are rejected. */
export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export interface SvixHeaders {
  id?: string;
  timestamp?: string;
  signature?: string;
}

/**
 * Verifies a Svix signature: HMAC-SHA256 over `${id}.${timestamp}.${body}` keyed with the
 * base64 decoded part of `whsec_<base64>`, compared against every `v1,<base64>` entry of the
 * space separated svix-signature header. Returns false on any problem.
 */
export function verifySvix(secret: string | undefined, headers: SvixHeaders, rawBody: Buffer | string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  if (!/^\d+$/.test(headers.timestamp)) return false;
  const ts = Number(headers.timestamp);
  if (Math.abs(nowSec - ts) > SVIX_TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret, 'base64');
  if (key.length === 0) return false;
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${body}`).digest();
  for (const entry of headers.signature.split(' ')) {
    const [version, sig] = entry.split(',');
    if (version !== 'v1' || !sig) continue;
    const given = Buffer.from(sig, 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

/** Produces the svix-signature header value for a body; used by tests and local tooling. */
export function signSvix(secret: string, id: string, timestamp: number | string, rawBody: string) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return 'v1,' + createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
}

/** "Name <a@b.c>" or "a@b.c" to "a@b.c", lower case. */
export function addressOf(value: string) {
  return (/<([^>]+)>/.exec(value)?.[1] ?? value).trim().toLowerCase();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Simple HTML to text: drops scripts, styles and quoted blocks, keeps line structure, decodes basic entities. */
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k in ENTITIES) return ENTITIES[k];
      if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)));
      return m;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Drops quoted history from a reply: everything from a common "On ... wrote:" marker (also when
 * the client wrapped it over two lines), an "Original Message" or Outlook header block, and any
 * line starting with '>'. Falls back to the whole text when nothing would be left.
 */
export function stripReply(text: string) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const markers = [
    /^On\s.+\swrote:$/i,
    /^-{2,}\s*Original Message\s*-{2,}$/i,
    /^_{5,}$/,
    /^From:\s.+/i,
    /^Le\s.+\sa écrit\s?:$/i,
    /^Am\s.+\sschrieb\s.+:$/i,
    /^في\s.+كتب:?$/,
  ];
  let cut = -1;
  for (let i = 0; i < lines.length && cut < 0; i++) {
    const l = lines[i].trim();
    const joined = i + 1 < lines.length ? `${l} ${lines[i + 1].trim()}` : l;
    if (i > 0 && markers.some((m) => m.test(l))) cut = i;
    else if (i > 0 && /^On\s/i.test(l) && /^On\s.+\swrote:$/i.test(joined)) cut = i;
  }
  const kept = (cut > 0 ? lines.slice(0, cut) : lines).filter((l) => !l.trimStart().startsWith('>'));
  return kept.join('\n').trim() || text.trim();
}

export interface ReceivedEmail {
  from?: string;
  to?: string[];
  subject?: string;
  text?: string | null;
  html?: string | null;
}

/** Fetches a received email's content from Resend. Throws on a non 2xx answer. */
export async function fetchReceivedEmail(emailId: string, apiKey: string): Promise<ReceivedEmail> {
  const res = await fetch(`${RESEND_RECEIVED_EMAIL_URL}/${encodeURIComponent(emailId)}`, { headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' } });
  if (!res.ok) throw new Error(`resend receiving ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as ReceivedEmail;
}
