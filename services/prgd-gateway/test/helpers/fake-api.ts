import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SessionCheckAnswer, SessionEvent, SessionEventAnswer } from '../../src/api';
import { randomSerial, signUserCertificate } from './openssh';

export const GATEWAY_SECRET = 'test-gateway-secret';

export interface FakeSession {
  sessionId: string;
  assetId: string;
  target: { host: string; port: number; username: string };
  expiresAt: Date;
  sudoPassword?: string;
  heartbeatSeconds?: number;
  /** Make the first upload URL already expired (the gateway must renew it). */
  expiredUploadUrl?: boolean;
  recording?: boolean;
}

/**
 * The API side of the gateway contract: session-check (signs a certificate for the gateway's key
 * with the test CA), session-events, secrets and recording-url, plus a presigned PUT target that
 * stands in for object storage.
 */
export class FakeApi {
  readonly ca: { privateKey: KeyObject } = { privateKey: generateKeyPairSync('ed25519').privateKey };
  readonly server: Server;
  url = '';
  readonly tokens = new Map<string, FakeSession>();
  readonly used = new Set<string>();
  readonly checks: Record<string, unknown>[] = [];
  readonly events: SessionEvent[] = [];
  readonly secretReads: { sessionId: string; ref: string }[] = [];
  readonly recordingUrlCalls: string[] = [];
  readonly uploads = new Map<string, { body: Buffer; contentType: string }>();
  readonly unauthorized: string[] = [];
  /** Decide the answer to an event; default continue. */
  onEvent: (ev: SessionEvent) => Partial<SessionEventAnswer> | void = () => undefined;
  private readonly expiresAt = new Map<string, Date>();

  constructor() {
    this.server = createServer((req, res) => void this.handle(req, res));
  }

  async listen() {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  close() {
    this.server.closeAllConnections();
    return new Promise<void>((r) => this.server.close(() => r()));
  }

  add(token: string, s: FakeSession) {
    this.tokens.set(token, s);
    this.expiresAt.set(s.sessionId, s.expiresAt);
  }

  /** Moves a session's grant expiry (an extension); the next event answer carries it. */
  extend(sessionId: string, to: Date) {
    this.expiresAt.set(sessionId, to);
  }

  eventsOf(sessionId: string) {
    return this.events.filter((e) => e.sessionId === sessionId);
  }

  private async body(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  private json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private recordingTarget(sessionId: string, expired: boolean) {
    const key = `sessions/2026/09/${sessionId}.cast`;
    return {
      format: 'asciicast-v2',
      key,
      uploadUrl: `${this.url}/upload/${key}?X-Amz-Signature=${expired ? 'expired' : 'ok'}`,
      uploadMethod: 'PUT',
      contentType: 'application/x-asciicast',
      uploadUrlExpiresAt: new Date(Date.now() + (expired ? -60_000 : 3_600_000)).toISOString(),
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', this.url);
    if (req.method === 'PUT' && url.pathname.startsWith('/upload/')) {
      const body = await this.body(req);
      if (url.searchParams.get('X-Amz-Signature') !== 'ok') return this.json(res, 403, { error: 'expired' });
      if (Number(req.headers['content-length']) !== body.length) return this.json(res, 411, { error: 'length' });
      this.uploads.set(url.pathname.slice('/upload/'.length), { body, contentType: String(req.headers['content-type']) });
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.headers['x-prgd-gateway-secret'] !== GATEWAY_SECRET) {
      this.unauthorized.push(url.pathname);
      return this.json(res, 401, { error: { code: 'unauthorized', message: 'Wrong gateway secret' } });
    }
    const body = JSON.parse((await this.body(req)).toString() || '{}');
    switch (url.pathname) {
      case '/internal/gateway/session-check': {
        this.checks.push(body);
        const s = this.tokens.get(body.token);
        if (!s || (body.sessionId && body.sessionId !== s.sessionId)) return this.json(res, 401, { error: { code: 'token_invalid', message: 'Unknown gateway token' } });
        if (this.used.has(body.token)) return this.json(res, 409, { error: { code: 'token_used', message: 'The gateway token was already used' } });
        this.used.add(body.token);
        const principal = `prgd-asset-${s.assetId}`;
        const certificate = signUserCertificate(
          { publicKey: body.publicKey, serial: randomSerial(), keyId: `prgd-session-${s.sessionId}`, principals: [principal], validAfter: new Date(Date.now() - 60_000), validBefore: s.expiresAt },
          this.ca,
        );
        const answer: SessionCheckAnswer = {
          sessionId: s.sessionId,
          grantId: `grant-${s.sessionId}`,
          expiresAt: s.expiresAt.toISOString(),
          engineer: { id: 'user1', name: 'Rami Haddad' },
          asset: { id: s.assetId, name: 'web-1', contractId: 'contract1' },
          ticket: { id: 'ticket1', number: 1042 },
          maintenanceRunId: null,
          target: s.target,
          certificate,
          certSerial: '1',
          principals: [principal],
          validBefore: s.expiresAt.toISOString(),
          secrets: s.sudoPassword ? [{ ref: `assets/${s.assetId}`, keys: ['sudo_password'] }] : [],
          recording: s.recording === false ? null : this.recordingTarget(s.sessionId, !!s.expiredUploadUrl),
          policy: { clipboardPaste: true, fileDownload: false },
          banner: `This session is recorded. web-1, ticket #1042, access until ${s.expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
          kill: { natsSubject: 'prgd.gateway.sessions.kill', heartbeatSeconds: s.heartbeatSeconds ?? 30 },
        };
        return this.json(res, 200, answer);
      }
      case '/internal/gateway/session-events': {
        this.events.push(body);
        const extra = this.onEvent(body) ?? {};
        const exp = this.expiresAt.get(body.sessionId);
        return this.json(res, 200, { ok: true, action: 'continue', expiresAt: exp?.toISOString() ?? null, ...extra });
      }
      case '/internal/gateway/secrets': {
        this.secretReads.push(body);
        const s = [...this.tokens.values()].find((t) => t.sessionId === body.sessionId);
        if (!s || body.ref !== `assets/${s.assetId}`) return this.json(res, 403, { error: { code: 'forbidden', message: 'no' } });
        return this.json(res, 200, { ref: body.ref, values: s.sudoPassword ? { sudo_password: s.sudoPassword } : {} });
      }
      case '/internal/gateway/recording-url': {
        this.recordingUrlCalls.push(body.sessionId);
        return this.json(res, 200, this.recordingTarget(body.sessionId, false));
      }
      default:
        return this.json(res, 404, { error: { code: 'not_found', message: 'no' } });
    }
  }
}
