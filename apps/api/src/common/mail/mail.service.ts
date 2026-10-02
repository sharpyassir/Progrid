import { Injectable, Logger } from '@nestjs/common';
import { loadConfig } from '../../config/config';
import { entityProfile, type BillingEntityId } from '../entities/entities';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Where replies should go; defaults to the support inbox when set. */
  replyTo?: string;
  /** Set by MailService: the sender it used (tests read it). */
  from?: string;
  /**
   * The company the recipient deals with. Sets the sender (no-reply@progrid.co or progrid.sa),
   * the reply address (that company's support inbox) and the logo host. Without it the mail goes
   * out from MAIL_FROM with replies to SUPPORT_INBOX (staff and system mail).
   */
  entity?: BillingEntityId;
  /** Files sent with the message (monthly report PDFs). */
  attachments?: { filename: string; content: Buffer; contentType: string }[];
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
    const { MAIL_PROVIDER, MAIL_API_KEY, COMPANY_NAME } = loadConfig();
    const { from, replyTo: defaultReplyTo, consoleUrl, footer } = senderFor(mail.entity);
    const MAIL_FROM = from;
    mail.from = from;
    // Customer mail links to the customer's own console: links built on the primary console
    // (CONSOLE_URL) are pointed at the company's console (console.progrid.sa for Progrid Arabia).
    const primary = loadConfig().CONSOLE_URL.replace(/\/+$/, '');
    if (mail.entity && consoleUrl !== primary) {
      const relink = (s: string) => s.split(`${primary}/`).join(`${consoleUrl}/`);
      mail.text = relink(mail.text);
      if (mail.html) mail.html = relink(mail.html);
    }
    const replyTo = mail.replyTo ?? (defaultReplyTo || undefined);
    const html = mail.html ?? wrap(mail.text, `${consoleUrl}/brand/progrid-logo.png`, COMPANY_NAME, footer);
    switch (MAIL_PROVIDER) {
      case 'postmark': {
        const res = await fetch('https://api.postmarkapp.com/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', 'X-Postmark-Server-Token': MAIL_API_KEY ?? '' },
          body: JSON.stringify({
            From: MAIL_FROM, To: mail.to, Subject: mail.subject, TextBody: mail.text, HtmlBody: html, MessageStream: 'outbound', ...(replyTo ? { ReplyTo: replyTo } : {}),
            ...(mail.attachments?.length ? { Attachments: mail.attachments.map((a) => ({ Name: a.filename, Content: a.content.toString('base64'), ContentType: a.contentType })) } : {}),
          }),
        });
        if (!res.ok) throw new Error(`postmark ${res.status}: ${await res.text()}`);
        return;
      }
      case 'resend': {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${MAIL_API_KEY ?? ''}` },
          body: JSON.stringify({
            from: MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html, ...(replyTo ? { reply_to: replyTo } : {}),
            ...(mail.attachments?.length ? { attachments: mail.attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })) } : {}),
          }),
        });
        if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
        return;
      }
      default:
        this.last = mail;
        this.log.log(`[mail:log] to=${mail.to} subject="${mail.subject}"${mail.attachments?.length ? ` attachments=${mail.attachments.map((a) => `${a.filename} (${a.content.length} bytes)`).join(', ')}` : ''}\n${mail.text}`);
    }
  }
}

/** Sender, reply address, logo host and footer line for a mail of this company (or a staff mail). */
export function senderFor(entity?: BillingEntityId) {
  const c = loadConfig();
  if (!entity) return { from: c.MAIL_FROM, replyTo: c.SUPPORT_INBOX, consoleUrl: c.CONSOLE_URL.replace(/\/+$/, ''), footer: c.COMPANY_NAME };
  const e = entityProfile(entity);
  return { from: e.mailFrom, replyTo: e.supportEmail, consoleUrl: e.consoleUrl, footer: `${c.COMPANY_NAME} · ${e.legalName}` };
}

/** Plain text mail as simple HTML: the official logo on top, the text below, and a thin footer. */
function wrap(text: string, logoUrl: string, company: string, footer = company) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#0b47c9">$1</a>');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px">
<div style="padding:4px 0 16px;border-bottom:1px solid #e4ecf9;margin-bottom:16px"><img src="${logoUrl}" alt="${company}" height="32" style="height:32px;display:block" /></div>
<pre style="white-space:pre-wrap;font:inherit;margin:0">${esc}</pre>
<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e4ecf9;font-size:12px;color:#64748b">${footer}</div>
</div>`;
}
