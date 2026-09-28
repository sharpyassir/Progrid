import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { HttpGatewayApi, type GatewayApi } from './api';
import type { GatewayConfig } from './config';
import { HostKeyVerifier } from './host-keys';
import { KILL_SUBJECT, NatsKillListener, type KillListener, type KillMessage } from './kill';
import { log } from './log';
import { TerminalSession } from './session';

export interface GatewayOptions {
  config: GatewayConfig;
  api?: GatewayApi;
  hostKeys?: HostKeyVerifier;
  /** Kill source; defaults to NATS when NATS_URL is set, none otherwise. */
  killListener?: KillListener | null;
}

const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_FRAME = 1024 * 1024;

export class Gateway {
  readonly server: Server;
  readonly config: GatewayConfig;
  /** Sessions the API confirmed, by session id (kill routing). */
  readonly sessions = new Map<string, TerminalSession>();
  /** Every open connection, confirmed or not (capacity). */
  readonly connections = new Set<TerminalSession>();
  private readonly api: GatewayApi;
  private readonly hostKeys: HostKeyVerifier;
  private readonly wss: WebSocketServer;
  private readonly killListener: KillListener | null;

  constructor(opts: GatewayOptions) {
    this.config = opts.config;
    this.api = opts.api ?? new HttpGatewayApi(opts.config.apiUrl, opts.config.gatewaySecret);
    this.hostKeys = opts.hostKeys ?? new HostKeyVerifier(opts.config.knownHostsFile);
    this.killListener =
      opts.killListener !== undefined ? opts.killListener : opts.config.natsUrl ? new NatsKillListener(opts.config.natsUrl, opts.config.natsToken, KILL_SUBJECT) : null;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false });
    this.server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      if (req.method === 'GET' && path === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: true, gatewayId: this.config.gatewayId, sessions: this.connections.size, maxSessions: this.config.maxSessions, hostKeys: this.hostKeys.enforcing ? 'known_hosts' : 'trust_on_first_use' }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }));
    });
    this.server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));
  }

  async listen(port = this.config.port, host = '0.0.0.0') {
    await new Promise<void>((resolve) => this.server.listen(port, host, resolve));
    if (this.killListener) {
      this.killListener.start((m) => this.onKill(m)).catch((e) => log.error('kill listener failed', { error: (e as Error).message }));
    }
    return (this.server.address() as AddressInfo).port;
  }

  /** Ends every session (reason error), waits for their recordings, then stops. */
  async close() {
    this.server.close();
    await this.killListener?.close();
    const all = [...this.connections];
    for (const s of all) void s.end('error', 'The gateway is shutting down');
    await Promise.all(all.map((s) => s.done));
    this.wss.close();
  }

  /** Rereads PRGD_GATEWAY_KNOWN_HOSTS (SIGHUP). */
  reloadHostKeys() {
    this.hostKeys.reload();
  }

  onKill(m: KillMessage) {
    const s = this.sessions.get(m.sessionId);
    if (!s) return;
    log.info('kill', { sessionId: m.sessionId, reason: m.reason });
    s.kill(m.reason ?? 'killed');
  }

  private reject(socket: Duplex, status: number, message: string) {
    socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
  }

  private clientIp(req: IncomingMessage) {
    const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    return (this.config.trustProxy && fwd) || req.socket.remoteAddress || '';
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? '/', 'http://gateway');
    if (url.pathname !== '/v1/terminal') return this.reject(socket, 404, 'Not Found');
    const origin = String(req.headers.origin ?? '').replace(/\/+$/, '');
    if (!origin || !this.config.allowedOrigins.includes(origin)) {
      log.warn('origin refused', { origin, ip: this.clientIp(req) });
      return this.reject(socket, 403, 'Forbidden');
    }
    const sessionParam = url.searchParams.get('session') ?? '';
    if (!SESSION_ID.test(sessionParam)) return this.reject(socket, 400, 'Bad Request');
    if (this.connections.size >= this.config.maxSessions) return this.reject(socket, 503, 'Service Unavailable');
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const session = new TerminalSession({
        ws,
        api: this.api,
        config: this.config,
        hostKeys: this.hostKeys,
        sessionParam,
        clientIp: this.clientIp(req),
        onIdentified: (s) => {
          if (s.sessionId) this.sessions.set(s.sessionId, s);
        },
        onFinished: (s) => {
          this.connections.delete(s);
          if (s.sessionId && this.sessions.get(s.sessionId) === s) this.sessions.delete(s.sessionId);
          log.info('session finished', { sessionId: s.sessionId, reason: s.endReason, bytesIn: s.bytesIn, bytesOut: s.bytesOut });
        },
      });
      this.connections.add(session);
      session.start();
    });
  }
}
