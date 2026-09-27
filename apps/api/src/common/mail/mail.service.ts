import { Injectable, Logger } from '@nestjs/common';
import { loadConfig } from '../../config/config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Where replies should go; defaults to the support inbox when set. */
  replyTo?: string;
}

/**
 * Outbound email. Providers:
 *   log      - prints the message (local dev, CI); the last message is kept for tests
 *   postmark - Postmark HTTP API (MAIL_API_KEY = server token)
 *   resend   - Resend HTTP API (MAIL_API_KEY)
 * Templates are plain text first; HTML is a light wrapper so they render everywhere.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  /** Last message sent through the `log` provider (used by tests and the dev console). */
  last?: Mail;

  async send(mail: Mail): Promise<void> {
    const { MAIL_PROVIDER, MAIL_FROM, MAIL_API_KEY, CONSOLE_URL, COMPANY_NAME, SUPPORT_INBOX } = loadConfig();
    const replyTo = mail.replyTo ?? (SUPPORT_INBOX || undefined);
    const html = mail.html ?? wrap(mail.text, `${CONSOLE_URL}/brand/progrid-logo.png`, COMPANY_NAME);
    switch (MAIL_PROVIDER) {
      case 'postmark': {
        const res = await fetch('https://api.postmarkapp.com/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', 'X-Postmark-Server-Token': MAIL_API_KEY ?? '' },
          body: JSON.stringify({ From: MAIL_FROM, To: mail.to, Subject: mail.subject, TextBody: mail.text, HtmlBody: html, MessageStream: 'outbound', ...(replyTo ? { ReplyTo: replyTo } : {}) }),
        });
        if (!res.ok) throw new Error(`postmark ${res.status}: ${await res.text()}`);
        return;
      }
      case 'resend': {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${MAIL_API_KEY ?? ''}` },
          body: JSON.stringify({ from: MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
        });
        if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
        return;
      }
      default:
        this.last = mail;
        this.log.log(`[mail:log] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
    }
  }
}

/** Plain text mail as simple HTML: the official logo on top, the text below, and a thin footer. */
function wrap(text: string, logoUrl: string, company: string) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#0b47c9">$1</a>');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px">
<div style="padding:4px 0 16px;border-bottom:1px solid #e4ecf9;margin-bottom:16px"><img src="${logoUrl}" alt="${company}" height="32" style="height:32px;display:block" /></div>
<pre style="white-space:pre-wrap;font:inherit;margin:0">${esc}</pre>
<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e4ecf9;font-size:12px;color:#64748b">${company}</div>
</div>`;
}
