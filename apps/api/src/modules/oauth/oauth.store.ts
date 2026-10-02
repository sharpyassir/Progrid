import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { RedisService } from '../../common/redis/redis.service';
import { ApiError } from '../../common/errors/api-error';
import type { Intent, ProviderAccount, ProviderId } from './linking';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** A sign in waiting for the provider to send the browser back. Keyed by `state`. */
export interface PendingLogin {
  provider: ProviderId;
  intent: Intent;
  nonce: string;
  codeVerifier: string;
  /** sha256 of the random value in the browser's HttpOnly cookie. */
  browserHash: string;
  returnPath: string;
  invite?: string;
  locale?: string;
  /** intent link: who is linking. */
  linkUserId?: string;
  /** Public domain the sign in started on (progrid.co or progrid.sa): its API takes the callback, its console gets the person back. */
  domain?: string;
  /** Billing country picked on the signup form, for a new account. */
  country?: string;
  /** Partner referral (prgd_ref cookie value) and promo code from the signup form, for a new account. */
  ref?: string;
  promoCode?: string;
}

/** The outcome of a callback, redeemed once by the console with the short lived code. */
export interface Completion {
  provider: ProviderId;
  userId: string;
  returnPath: string;
  created: boolean;
  /** Existing identity used for this sign in (touches lastUsedAt). */
  identityId?: string;
  /** Identity to link once the sign in is complete (after the second factor, when there is one). */
  link?: ProviderAccount;
  invite?: string;
  /** Session already issued at the callback (a new account that joined an invited team). */
  session?: { token: string; teamId: string };
}

const STATE_TTL = 600;
const CODE_TTL = 60;
const TOTP_TTL = 300;
const LINK_TICKET_TTL = 60;

/** Server side OAuth state in Redis. Every value is single use: reads delete. */
@Injectable()
export class OAuthStore {
  constructor(private readonly redis: RedisService) {}

  async putState(state: string, p: PendingLogin) {
    await this.set(`oauth:state:${state}`, p, STATE_TTL);
  }
  takeState(state: string) {
    return this.take<PendingLogin>(`oauth:state:${state}`);
  }

  async putCode(c: Completion) {
    const code = randomToken();
    await this.set(`oauth:code:${sha256(code)}`, c, CODE_TTL);
    return code;
  }
  takeCode(code: string) {
    return this.take<Completion>(`oauth:code:${sha256(code)}`);
  }

  async putTotpTicket(c: Completion) {
    const ticket = randomToken();
    await this.set(`oauth:totp:${sha256(ticket)}`, { ...c, attempts: 0 }, TOTP_TTL);
    return ticket;
  }
  /** Reads a second factor ticket without using it up; a wrong code only counts an attempt. */
  async getTotpTicket(ticket: string) {
    const raw = await this.cmd(() => this.redis.client.get(`oauth:totp:${sha256(ticket)}`));
    return raw ? (JSON.parse(raw) as Completion & { attempts: number }) : null;
  }
  async failTotpTicket(ticket: string, c: Completion & { attempts: number }) {
    const key = `oauth:totp:${sha256(ticket)}`;
    if (c.attempts + 1 >= 5) await this.cmd(() => this.redis.client.del(key));
    else await this.cmd(() => this.redis.client.set(key, JSON.stringify({ ...c, attempts: c.attempts + 1 }), 'KEEPTTL'));
  }
  takeTotpTicket(ticket: string) {
    return this.take<Completion & { attempts: number }>(`oauth:totp:${sha256(ticket)}`);
  }

  async putLinkTicket(v: { userId: string; sessionId: string }) {
    const ticket = randomToken();
    await this.set(`oauth:link:${sha256(ticket)}`, v, LINK_TICKET_TTL);
    return ticket;
  }
  takeLinkTicket(ticket: string) {
    return this.take<{ userId: string; sessionId: string }>(`oauth:link:${sha256(ticket)}`);
  }

  private async set(key: string, v: unknown, ttl: number) {
    await this.cmd(() => this.redis.client.set(key, JSON.stringify(v), 'EX', ttl));
  }

  private async take<T>(key: string): Promise<T | null> {
    const res = await this.cmd(() => this.redis.client.multi().get(key).del(key).exec());
    const raw = res?.[0]?.[1] as string | null | undefined;
    return raw ? (JSON.parse(raw) as T) : null;
  }

  private async cmd<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch {
      throw new ApiError(503, 'unavailable', 'Sign in with Google or Microsoft is unavailable right now. Try again in a minute or use your password.');
    }
  }
}
