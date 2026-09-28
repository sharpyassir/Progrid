import type { Client, ClientChannel } from 'ssh2';
import type { RawData, WebSocket } from 'ws';
import { ApiRefusal, type GatewayApi, type RecordingTarget, type SessionCheckAnswer, type SessionEvent, type SessionEventAnswer } from './api';
import type { GatewayConfig } from './config';
import type { HostKeyVerifier } from './host-keys';
import { log } from './log';
import { AsciicastRecorder, putFile } from './recorder';
import { Redactor, SudoResponder } from './secrets';
import { connectWithCertificate, openShell } from './ssh-client';
import { blobType, certificateBlob, fingerprintBlob, generateEphemeralKey } from './ssh-keys';

/** Why a session ended, as the API's `ended` event takes it. */
export type EndReason = 'client_closed' | 'grant_expired' | 'killed' | 'ssh_closed' | 'error';

/** Server to client frames. */
export type ServerFrame =
  | { type: 'ready'; sessionId: string; expiresAt: string; banner: string; policy: SessionCheckAnswer['policy']; asset: { id: string; name: string }; ticket: SessionCheckAnswer['ticket']; recorded: boolean }
  | { type: 'output'; data: string }
  | { type: 'notice'; message: string; expiresAt?: string }
  | { type: 'pong' }
  | { type: 'closed'; reason: string; message?: string };

export interface SessionDeps {
  ws: WebSocket;
  api: GatewayApi;
  config: GatewayConfig;
  hostKeys: HostKeyVerifier;
  /** The ?session= of the URL; must match the token's session. */
  sessionParam: string;
  clientIp: string;
  /** Called once the API confirmed the session id (for kill routing) and when it is over. */
  onIdentified(s: TerminalSession): void;
  onFinished(s: TerminalSession): void;
}

const MAX_COLS = 1000;
const MAX_ROWS = 1000;
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 512 * 1024;
const FLUSH_MS = 40;
const MAX_EVENT_FAILURES = 3;
const WS_CLOSE = { normal: 1000, error: 1011, auth: 4001, refused: 4003 } as const;

const describe = (seconds: number) =>
  seconds % 60 === 0 ? `${seconds / 60} minute${seconds === 60 ? '' : 's'}` : `${seconds} second${seconds === 1 ? '' : 's'}`;

const clampSize = (v: unknown, max: number, d: number) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max ? (v as number) : d);

export class TerminalSession {
  state: 'auth' | 'connecting' | 'live' | 'closing' | 'closed' = 'auth';
  sessionId: string | null = null;
  endReason: EndReason | null = null;
  bytesIn = 0;
  bytesOut = 0;
  /** Resolves when the session finished everything (recording uploaded, ended sent). */
  readonly done: Promise<void>;

  private resolveDone!: () => void;
  private check: SessionCheckAnswer | null = null;
  private ssh: Client | null = null;
  private stream: ClientChannel | null = null;
  private recorder: AsciicastRecorder | null = null;
  private redactor = new Redactor([]);
  private sudo: SudoResponder | null = null;
  private cols = 80;
  private rows = 24;
  private expiresAt = 0;
  private hostKey: Buffer | null = null;
  private hostKeyRefusal: string | null = null;
  private timers = new Set<NodeJS.Timeout>();
  private expiryTimers: NodeJS.Timeout[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private events: Promise<unknown> = Promise.resolve();
  private eventFailures = 0;
  private alive = true;
  private paused = false;

  constructor(private readonly d: SessionDeps) {
    this.done = new Promise((r) => (this.resolveDone = r));
  }

  start() {
    const { ws, config } = this.d;
    this.timer(() => {
      if (this.state === 'auth') this.refuse('auth_timeout', 'No auth frame within ' + config.authTimeoutSeconds + ' seconds', WS_CLOSE.auth);
    }, config.authTimeoutSeconds * 1000);
    ws.on('message', (data, isBinary) => this.onMessage(data, isBinary));
    ws.on('close', () => void this.end('client_closed'));
    ws.on('error', () => void this.end('client_closed'));
    ws.on('pong', () => (this.alive = true));
  }

  /** A kill from NATS or from the API. */
  kill(reason: string) {
    void this.end('killed', reason);
  }

  // ---- client frames ----

  private onMessage(data: RawData, isBinary: boolean) {
    let frame: Record<string, unknown>;
    try {
      if (isBinary) throw new Error('binary');
      frame = JSON.parse(data.toString());
      if (!frame || typeof frame !== 'object') throw new Error('not an object');
    } catch {
      if (this.state === 'auth') this.refuse('bad_frame', 'Frames are JSON text', WS_CLOSE.auth);
      return;
    }
    if (this.state === 'auth') {
      if (frame.type !== 'auth' || typeof frame.token !== 'string' || !frame.token) {
        this.refuse('auth_required', 'The first frame must be {"type":"auth","token":"..."}', WS_CLOSE.auth);
        return;
      }
      this.cols = clampSize(frame.cols, MAX_COLS, 80);
      this.rows = clampSize(frame.rows, MAX_ROWS, 24);
      this.state = 'connecting';
      this.authenticate(frame.token).catch((e) => {
        if (this.state === 'closing' && !this.sessionId) this.markClosed();
        else void this.end('error', (e as Error).message);
      });
      return;
    }
    switch (frame.type) {
      case 'input': {
        if (this.state !== 'live' || !this.stream || typeof frame.data !== 'string') return;
        const buf = frame.encoding === 'base64' ? Buffer.from(frame.data, 'base64') : Buffer.from(frame.data, 'utf8');
        if (!buf.length) return;
        this.bytesIn += buf.length;
        this.stream.write(buf);
        return;
      }
      case 'resize': {
        const cols = clampSize(frame.cols, MAX_COLS, 0);
        const rows = clampSize(frame.rows, MAX_ROWS, 0);
        if (!cols || !rows || (cols === this.cols && rows === this.rows)) return;
        this.cols = cols;
        this.rows = rows;
        if (this.state === 'live' && this.stream) {
          this.stream.setWindow(rows, cols, 0, 0);
          this.recorder?.resize(cols, rows);
        }
        return;
      }
      case 'ping':
        this.send({ type: 'pong' });
        return;
      default:
        return;
    }
  }

  // ---- connecting ----

  private async authenticate(token: string) {
    const { api, config } = this.d;
    const key = generateEphemeralKey(`prgd-gateway-${config.gatewayId}`);
    let check: SessionCheckAnswer;
    try {
      check = await api.sessionCheck({ token, sessionId: this.d.sessionParam, publicKey: key.publicLine, gatewayId: config.gatewayId, clientIp: this.d.clientIp || undefined });
    } catch (e) {
      if (e instanceof ApiRefusal) this.refuse(e.code, e.message, e.status === 401 ? WS_CLOSE.auth : WS_CLOSE.refused);
      else this.refuse('api_unavailable', 'The gateway could not reach the API', WS_CLOSE.error);
      return;
    }
    this.check = check;
    this.sessionId = check.sessionId;
    this.d.onIdentified(this);
    if (this.state !== 'connecting') {
      // The browser left (or a kill arrived) while the API answered.
      await this.finish();
      return;
    }
    this.expiresAt = Date.parse(check.expiresAt);
    if (!(this.expiresAt > Date.now())) return this.end('grant_expired', 'The access grant expired');

    // Secrets: fetched once, kept in memory for this session only.
    const values: string[] = [];
    let sudoPassword: string | undefined;
    for (const ref of check.secrets ?? []) {
      try {
        const r = await api.secrets(check.sessionId, ref.ref);
        for (const [k, v] of Object.entries(r.values ?? {})) {
          if (typeof v !== 'string') continue;
          values.push(v);
          if (k === 'sudo_password' && sudoPassword === undefined) sudoPassword = v;
        }
      } catch (e) {
        log.warn('secrets unavailable', { sessionId: check.sessionId, ref: ref.ref, error: (e as Error).message });
        this.notice('Stored credentials are unavailable for this session; sudo will ask you for a password.');
      }
    }
    this.redactor = new Redactor(values);
    this.sudo = new SudoResponder(check.target.username, sudoPassword);
    if (this.state !== 'connecting') return;

    let ssh: Client;
    try {
      const blob = certificateBlob(check.certificate, key);
      ssh = await connectWithCertificate({
        target: check.target,
        key,
        certificateBlob: blob,
        readyTimeoutMs: config.sshReadyTimeoutSeconds * 1000,
        verifyHostKey: (hk) => {
          const decision = this.d.hostKeys.check(check.asset.id, check.target.host, check.target.port, hk);
          this.hostKey = Buffer.from(hk);
          if (!decision.ok) this.hostKeyRefusal = decision.reason;
          return decision.ok;
        },
      });
    } catch (e) {
      const why = this.hostKeyRefusal ? `${this.hostKeyRefusal} (${this.hostKey ? fingerprintBlob(this.hostKey) : 'no key'})` : (e as Error).message;
      return this.end('error', `SSH connection failed: ${why}`);
    }
    this.ssh = ssh;
    if (this.state !== 'connecting') {
      ssh.end();
      return;
    }
    ssh.on('error', (e) => void this.end('error', `SSH error: ${e.message}`));
    ssh.on('close', () => void this.end('ssh_closed'));

    try {
      this.stream = await openShell(ssh, this.cols, this.rows);
    } catch (e) {
      return this.end('error', `The asset refused a shell: ${(e as Error).message}`);
    }
    if (this.state !== 'connecting') return;
    const stream = this.stream;
    stream.on('data', (b: Buffer) => this.onOutput(b));
    stream.stderr.on('data', (b: Buffer) => this.onOutput(b));
    stream.on('close', () => void this.end('ssh_closed'));

    if (check.recording) {
      this.recorder = new AsciicastRecorder({
        width: this.cols,
        height: this.rows,
        title: `${check.asset.name}${check.ticket ? ` #${check.ticket.number}` : ''} ${check.engineer?.name ?? ''} (${check.sessionId})`.replace(/\s+/g, ' ').trim(),
        spoolDir: config.spoolDir,
        env: { TERM: 'xterm-256color', SHELL: '/bin/sh' },
      });
    }

    this.state = 'live';
    this.send({
      type: 'ready',
      sessionId: check.sessionId,
      expiresAt: new Date(this.expiresAt).toISOString(),
      banner: check.banner,
      policy: check.policy,
      asset: { id: check.asset.id, name: check.asset.name },
      ticket: check.ticket,
      recorded: !!check.recording,
    });
    this.scheduleExpiry();
    const heartbeat = Math.max(1, check.kill?.heartbeatSeconds || config.heartbeatSeconds);
    this.interval(() => void this.event({ type: 'heartbeat' }), heartbeat * 1000);
    this.interval(() => this.keepalive(), config.keepaliveSeconds * 1000);
    const hk = this.hostKey;
    void this.event({
      type: 'started',
      ...(hk ? { hostKey: `${blobType(hk)} ${hk.toString('base64')}`, hostKeyFingerprint: fingerprintBlob(hk) } : {}),
    });
  }

  // ---- output ----

  private onOutput(chunk: Buffer) {
    if (this.state !== 'live') return;
    this.bytesOut += chunk.length;
    const decision = this.sudo?.observe(chunk) ?? { type: 'none' as const };
    this.emit(this.redactor.push(chunk));
    if (this.redactor.pending && !this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.emit(this.redactor.flush());
      }, FLUSH_MS);
    }
    if (decision.type === 'inject' && this.stream) {
      // Typed straight into the shell: never sent to the browser, never recorded, not counted as input.
      this.stream.write(decision.value + '\n');
      this.notice('The gateway entered the stored sudo password (not shown, not recorded).');
    } else if (decision.type === 'give_up') {
      this.notice('The stored sudo password was not accepted; the gateway will not answer sudo again in this session.');
    }
  }

  private emit(buf: Buffer) {
    if (!buf.length) return;
    this.recorder?.output(buf);
    this.send({ type: 'output', data: buf.toString('base64') });
    const ws = this.d.ws;
    if (!this.paused && ws.bufferedAmount > HIGH_WATER && this.stream) {
      this.paused = true;
      this.stream.pause();
      const check = setInterval(() => {
        if (ws.bufferedAmount < LOW_WATER || this.state !== 'live') {
          clearInterval(check);
          this.timers.delete(check);
          this.paused = false;
          this.stream?.resume();
        }
      }, 50);
      this.timers.add(check);
    }
  }

  // ---- enforcement ----

  private scheduleExpiry() {
    for (const t of this.expiryTimers) clearTimeout(t);
    this.expiryTimers = [];
    const exp = this.expiresAt;
    const at = new Date(exp).toISOString();
    const now = Date.now();
    for (const seconds of this.d.config.expiryNoticeSeconds) {
      const when = exp - seconds * 1000;
      if (when > now) this.expiryTimers.push(setTimeout(() => this.notice(`Access ends in ${describe(seconds)} (${at.slice(11, 16)} UTC). Save your work.`, at), when - now));
    }
    // setTimeout holds at most about 24.8 days; grants are hours long.
    this.expiryTimers.push(setTimeout(() => void this.end('grant_expired', 'The access grant expired'), Math.min(Math.max(0, exp - now), 2 ** 31 - 1)));
  }

  private keepalive() {
    const ws = this.d.ws;
    if (!this.alive) {
      ws.terminate();
      return;
    }
    this.alive = false;
    try {
      ws.ping();
    } catch {
      /* closing */
    }
  }

  /** Sends an event in order after the previous ones; acts on a kill or a moved expiry. */
  private event(ev: Omit<SessionEvent, 'sessionId' | 'gatewayId' | 'at' | 'bytesIn' | 'bytesOut'>): Promise<SessionEventAnswer | null> {
    const sessionId = this.sessionId;
    if (!sessionId) return Promise.resolve(null);
    const body: SessionEvent = { sessionId, gatewayId: this.d.config.gatewayId, at: new Date().toISOString(), bytesIn: this.bytesIn, bytesOut: this.bytesOut, ...ev };
    const p = this.events.then(async () => {
      try {
        const answer = await this.d.api.sessionEvent(body);
        this.eventFailures = 0;
        this.onAnswer(answer);
        return answer;
      } catch (e) {
        log.warn('session event failed', { sessionId, type: ev.type, error: (e as Error).message });
        // Fail closed: a live session the API cannot hear about is ended.
        if (ev.type === 'heartbeat' || ev.type === 'started') {
          this.eventFailures += 1;
          if (this.eventFailures >= MAX_EVENT_FAILURES) void this.end('error', 'The gateway lost contact with the API');
        }
        return null;
      }
    });
    this.events = p;
    return p;
  }

  private onAnswer(a: SessionEventAnswer) {
    if (this.state !== 'live' && this.state !== 'connecting') return;
    if (a.action === 'kill') {
      void this.end('killed', a.reason ?? 'killed');
      return;
    }
    if (a.expiresAt) {
      const exp = Date.parse(a.expiresAt);
      if (Number.isFinite(exp) && exp !== this.expiresAt) {
        const extended = exp > this.expiresAt;
        this.expiresAt = exp;
        if (this.state === 'live') {
          this.scheduleExpiry();
          const at = new Date(exp).toISOString();
          this.notice(extended ? `Access extended until ${at.slice(0, 16).replace('T', ' ')} UTC.` : `Access now ends at ${at.slice(0, 16).replace('T', ' ')} UTC.`, at);
        }
      }
    }
  }

  // ---- ending ----

  /** Ends the session once: tells the browser, closes SSH, reports, uploads the recording. */
  async end(reason: EndReason, message?: string) {
    if (this.state === 'closing' || this.state === 'closed') return this.done;
    const wasConnecting = this.state === 'connecting' && !this.sessionId;
    this.state = 'closing';
    this.endReason = reason;
    this.clearTimers();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.emit(this.redactor.flush());
    this.closeClient(reason, message, reason === 'error' ? WS_CLOSE.error : WS_CLOSE.normal);
    this.stream?.removeAllListeners('data');
    this.stream?.stderr.removeAllListeners('data');
    try {
      this.stream?.close();
    } catch {
      /* already closed */
    }
    this.ssh?.end();
    if (wasConnecting) {
      // session-check still in flight: authenticate() calls finish() when it answers.
      return this.done;
    }
    await this.finish(message);
    return this.done;
  }

  private async finish(message?: string) {
    if (this.state === 'closed') return;
    if (this.state !== 'closing') {
      this.state = 'closing';
      this.endReason = this.endReason ?? 'client_closed';
      this.clearTimers();
      this.ssh?.end();
    }
    const reason = this.endReason ?? 'client_closed';
    try {
      if (this.sessionId) {
        if (reason === 'error') await this.event({ type: 'error', error: (message ?? 'error').slice(0, 2000) });
        await this.event({ type: 'ended', reason });
        await this.storeRecording();
      }
    } catch (e) {
      log.error('finishing session', { sessionId: this.sessionId, error: (e as Error).message });
    } finally {
      this.markClosed();
    }
  }

  private async storeRecording() {
    const rec = this.recorder;
    const check = this.check;
    if (!rec || !check?.recording) return;
    const size = await rec.close();
    let target: RecordingTarget = check.recording;
    let lastError = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        if (attempt > 0 || Date.parse(target.uploadUrlExpiresAt) <= Date.now() + 5_000) target = await this.d.api.recordingUrl(check.sessionId);
        const status = await putFile(target.uploadUrl, rec.path, target.contentType || 'application/x-asciicast');
        if (status >= 200 && status < 300) {
          await this.event({ type: 'recording_stored', recordingKey: check.recording.key, recordingSize: size });
          rec.discard();
          log.info('recording stored', { sessionId: check.sessionId, key: check.recording.key, size });
          return;
        }
        lastError = `object storage answered ${status}`;
      } catch (e) {
        lastError = (e as Error).message;
      }
      await new Promise((r) => setTimeout(r, Math.min(8_000, 500 * 2 ** attempt)));
    }
    log.error('recording upload failed; the file is kept', { sessionId: check.sessionId, path: rec.path, error: lastError });
    await this.event({ type: 'error', error: `recording upload failed: ${lastError}`.slice(0, 2000) });
  }

  // ---- helpers ----

  private send(frame: ServerFrame) {
    const ws = this.d.ws;
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  }

  private notice(message: string, expiresAt?: string) {
    this.send(expiresAt ? { type: 'notice', message, expiresAt } : { type: 'notice', message });
  }

  private closeClient(reason: string, message: string | undefined, code: number) {
    const ws = this.d.ws;
    if (ws.readyState !== ws.OPEN) return;
    this.send(message ? { type: 'closed', reason, message } : { type: 'closed', reason });
    ws.close(code, reason.slice(0, 120));
  }

  /** Refuses before the session exists (auth problems, API refusals). */
  private refuse(reason: string, message: string, code: number) {
    if (this.state === 'closed') return;
    if (this.sessionId) {
      void this.end('error', message);
      return;
    }
    this.clearTimers();
    this.closeClient(reason, message, code);
    this.markClosed();
  }

  private markClosed() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.d.onFinished(this);
    this.resolveDone();
  }

  private timer(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private interval(fn: () => void, ms: number) {
    const t = setInterval(fn, ms);
    this.timers.add(t);
  }

  private clearTimers() {
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timers.clear();
    for (const t of this.expiryTimers) clearTimeout(t);
    this.expiryTimers = [];
  }
}
