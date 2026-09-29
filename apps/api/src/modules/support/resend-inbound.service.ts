import { Injectable, Logger } from '@nestjs/common';
import { loadConfig } from '../../config/config';
import { ApiError } from '../../common/errors/api-error';
import { RedisService } from '../../common/redis/redis.service';
import { SupportService } from './support.service';
import { addressOf, fetchReceivedEmail, htmlToText, stripReply, verifySvix, type SvixHeaders } from './resend-inbound';

/** Resend retries for up to about a day; keep processed ids a little longer. */
const DEDUPE_TTL_SECONDS = 3 * 24 * 3600;

interface ResendEvent {
  type?: string;
  data?: { email_id?: string; from?: string; to?: string[] | string; subject?: string };
}

/** Turns Resend `email.received` webhooks for the support inbox into support tickets. */
@Injectable()
export class ResendInboundService {
  private readonly log = new Logger(ResendInboundService.name);

  constructor(
    private readonly support: SupportService,
    private readonly redis: RedisService,
  ) {}

  async handle(rawBody: Buffer, headers: SvixHeaders) {
    const cfg = loadConfig();
    if (!verifySvix(cfg.RESEND_WEBHOOK_SECRET, headers, rawBody)) throw ApiError.unauthorized('Bad webhook signature');

    let event: ResendEvent;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as ResendEvent;
    } catch {
      throw ApiError.invalid('Body is not JSON');
    }
    if (event.type !== 'email.received' || !event.data?.email_id) return { ignored: true, reason: 'event_type' };

    const inbox = addressOf(cfg.SUPPORT_INBOX || '');
    const to = (Array.isArray(event.data.to) ? event.data.to : [event.data.to ?? '']).map(addressOf);
    if (!inbox || !to.includes(inbox)) return { ignored: true, reason: 'not_support_inbox' };

    const emailId = event.data.email_id;
    const key = `resend-inbound:${emailId}`;
    let claimed = true;
    try {
      claimed = (await this.redis.client.set(key, headers.id ?? '1', 'EX', DEDUPE_TTL_SECONDS, 'NX')) === 'OK';
    } catch (err) {
      // Without Redis a retry may open a second ticket; losing the mail would be worse.
      this.log.warn(`resend inbound dedupe unavailable: ${(err as Error).message}`);
    }
    if (!claimed) return { ignored: true, reason: 'duplicate' };

    try {
      if (!cfg.MAIL_API_KEY) throw new Error('MAIL_API_KEY is not set');
      const email = await fetchReceivedEmail(emailId, cfg.MAIL_API_KEY);
      const body = email.text?.trim() ? email.text : email.html ? htmlToText(email.html) : '';
      return await this.support.inbound({
        from: addressOf(email.from || event.data.from || ''),
        subject: email.subject ?? event.data.subject ?? '',
        text: stripReply(body),
      });
    } catch (err) {
      // Let Resend retry: release the id so the next delivery is processed.
      await this.redis.client.del(key).catch(() => undefined);
      this.log.error(`resend inbound ${emailId} failed: ${(err as Error).message}`);
      throw err instanceof ApiError ? err : new ApiError(502, 'upstream_error', 'Could not fetch the email from Resend');
    }
  }
}
