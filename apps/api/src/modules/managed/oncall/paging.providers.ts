import { Logger } from '@nestjs/common';
import type { PageChannel } from '@prisma/client';
import type { MailService } from '../../../common/mail/mail.service';
import { loadConfig } from '../../../config/config';
import type { StaffContact } from './oncall.service';

export interface OutgoingPage {
  pageId: string;
  to: StaffContact;
  urgency: 'high' | 'low';
  subject: string;
  message: string;
  /** Link to the alert or ticket in the back office. */
  url: string;
}

/** One way of reaching a person. `send` throws on failure; the page row records the error. */
export interface PagingProvider {
  readonly name: string;
  readonly channel: PageChannel;
  /** False when the provider is not configured or the person has no address for it. */
  canReach(to: StaffContact): boolean;
  send(page: OutgoingPage): Promise<void>;
}

/** Records pages without sending them (PAGING_MODE=log, the default in development and tests). */
export class LogPagingProvider implements PagingProvider {
  readonly name = 'log';
  private readonly log = new Logger('paging');
  constructor(readonly channel: PageChannel) {}
  canReach() {
    return true;
  }
  async send(p: OutgoingPage) {
    this.log.log(`[page:${this.channel.toLowerCase()}:${p.urgency}] to=${p.to.email} ${p.subject}: ${p.message}`);
  }
}

/** Twilio Programmable Messaging for SMS and WhatsApp (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, TWILIO_WHATSAPP_FROM). */
export class TwilioPagingProvider implements PagingProvider {
  readonly name: string;
  constructor(readonly channel: 'SMS' | 'WHATSAPP') {
    this.name = channel === 'SMS' ? 'twilio_sms' : 'twilio_whatsapp';
  }

  private from() {
    const c = loadConfig();
    return this.channel === 'SMS' ? c.TWILIO_FROM : c.TWILIO_WHATSAPP_FROM;
  }

  canReach(to: StaffContact) {
    const c = loadConfig();
    return !!(c.TWILIO_ACCOUNT_SID && c.TWILIO_AUTH_TOKEN && this.from() && to.phone);
  }

  async send(p: OutgoingPage) {
    const c = loadConfig();
    const wa = this.channel === 'WHATSAPP';
    const body = new URLSearchParams({ To: `${wa ? 'whatsapp:' : ''}${p.to.phone}`, From: `${wa ? 'whatsapp:' : ''}${this.from()}`, Body: `${p.subject}\n${p.message}\n${p.url}`.slice(0, 1500) });
    const res = await fetch(`${c.TWILIO_BASE_URL}/2010-04-01/Accounts/${encodeURIComponent(c.TWILIO_ACCOUNT_SID!)}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${c.TWILIO_ACCOUNT_SID}:${c.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`twilio ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

/** Generic push webhook (PUSH_WEBHOOK_URL), for a mobile push relay or an incident tool. */
export class PushWebhookPagingProvider implements PagingProvider {
  readonly name = 'push_webhook';
  readonly channel = 'PUSH' as const;
  canReach() {
    return !!loadConfig().PUSH_WEBHOOK_URL;
  }
  async send(p: OutgoingPage) {
    const res = await fetch(loadConfig().PUSH_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'prgd-paging' },
      body: JSON.stringify({ pageId: p.pageId, userId: p.to.id, email: p.to.email, urgency: p.urgency, title: p.subject, message: p.message, url: p.url }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`push webhook ${res.status}`);
  }
}

export class EmailPagingProvider implements PagingProvider {
  readonly name = 'email';
  readonly channel = 'EMAIL' as const;
  constructor(private readonly mail: MailService) {}
  canReach(to: StaffContact) {
    return !!to.email;
  }
  async send(p: OutgoingPage) {
    await this.mail.send({ to: p.to.email, subject: `${p.urgency === 'high' ? '[PAGE] ' : ''}${p.subject}`, text: `${p.message}\n\nAcknowledge in the back office:\n${p.url}` });
  }
}
