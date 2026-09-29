import { describe, expect, it } from 'vitest';
import { addressOf, htmlToText, signSvix, stripReply, verifySvix } from './resend-inbound';

const secret = 'whsec_' + Buffer.from('a very secret signing key 123456').toString('base64');
const body = JSON.stringify({ type: 'email.received', data: { email_id: 'e1', to: ['support@progrid.sa'] } });
const now = 1_760_000_000;

function headers(opts: { secret?: string; ts?: number; body?: string; id?: string } = {}) {
  const id = opts.id ?? 'msg_1';
  const ts = opts.ts ?? now;
  return { id, timestamp: String(ts), signature: signSvix(opts.secret ?? secret, id, ts, opts.body ?? body) };
}

describe('verifySvix', () => {
  it('accepts a valid signature', () => {
    expect(verifySvix(secret, headers(), Buffer.from(body), now)).toBe(true);
  });

  it('accepts when any of several signatures matches', () => {
    const h = headers();
    expect(verifySvix(secret, { ...h, signature: `v1,AAAA ${h.signature}` }, body, now)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifySvix(secret, headers(), body.replace('e1', 'e2'), now)).toBe(false);
  });

  it('rejects a signature made with another secret', () => {
    const other = 'whsec_' + Buffer.from('another key entirely, not ours!').toString('base64');
    expect(verifySvix(secret, headers({ secret: other }), body, now)).toBe(false);
  });

  it('rejects timestamps older or newer than five minutes', () => {
    expect(verifySvix(secret, headers({ ts: now - 301 }), body, now)).toBe(false);
    expect(verifySvix(secret, headers({ ts: now + 301 }), body, now)).toBe(false);
    expect(verifySvix(secret, headers({ ts: now - 299 }), body, now)).toBe(true);
  });

  it('rejects a missing secret or missing headers', () => {
    expect(verifySvix(undefined, headers(), body, now)).toBe(false);
    expect(verifySvix('', headers(), body, now)).toBe(false);
    expect(verifySvix(secret, { ...headers(), signature: undefined }, body, now)).toBe(false);
    expect(verifySvix(secret, { ...headers(), id: 'msg_2' }, body, now)).toBe(false);
  });
});

describe('stripReply', () => {
  it('drops everything after an "On ... wrote:" line', () => {
    const text = 'Thanks, that fixed it.\n\nOn Mon, 29 Sep 2026 at 10:00, Progrid <support@progrid.sa> wrote:\n> Try restarting.\n> Regards';
    expect(stripReply(text)).toBe('Thanks, that fixed it.');
  });

  it('handles a marker wrapped over two lines', () => {
    const text = 'Still broken.\n\nOn Mon, 29 Sep 2026 at 10:00, Progrid Support\n<support@progrid.sa> wrote:\n\nold text';
    expect(stripReply(text)).toBe('Still broken.');
  });

  it('drops quoted lines and Outlook headers', () => {
    expect(stripReply('Yes please\n> quoted\nmore')).toBe('Yes please\nmore');
    expect(stripReply('Ok\n\n-----Original Message-----\nFrom: x')).toBe('Ok');
    expect(stripReply('Ok\n________________________________\nFrom: Support\nSent: today')).toBe('Ok');
  });

  it('keeps the whole text when nothing would be left', () => {
    expect(stripReply('> only quoted')).toBe('> only quoted');
  });

  it('leaves a message without history untouched', () => {
    expect(stripReply('Line one\r\nLine two')).toBe('Line one\nLine two');
  });
});

describe('htmlToText', () => {
  it('strips tags, keeps line breaks and decodes entities', () => {
    const html = '<html><head><style>p{}</style></head><body><p>Hello &amp; welcome</p><div>a&lt;b&gt;c&nbsp;d&#39;s &#x41;</div>line<br>two<blockquote>old</blockquote></body></html>';
    expect(htmlToText(html)).toBe("Hello & welcome\na<b>c d's A\nline\ntwo");
  });
});

describe('addressOf', () => {
  it('extracts and lower cases the address', () => {
    expect(addressOf('Jane <Jane@Example.COM>')).toBe('jane@example.com');
    expect(addressOf(' Support@Progrid.sa ')).toBe('support@progrid.sa');
  });
});
