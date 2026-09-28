/**
 * Client for the API's /internal/gateway endpoints. Bodies and answers follow
 * docs/devops-console.md, "Gateway contract".
 */

export interface RecordingTarget {
  format: string;
  key: string;
  uploadUrl: string;
  uploadMethod: string;
  contentType: string;
  uploadUrlExpiresAt: string;
}

export interface SessionCheckRequest {
  token: string;
  sessionId?: string;
  publicKey: string;
  gatewayId?: string;
  clientIp?: string;
}

export interface SessionCheckAnswer {
  sessionId: string;
  grantId: string;
  expiresAt: string;
  engineer: { id: string; name: string };
  asset: { id: string; name: string; contractId: string };
  ticket: { id: string; number: number } | null;
  maintenanceRunId: string | null;
  target: { host: string; port: number; username: string };
  certificate: string;
  certSerial: string;
  principals: string[];
  validBefore: string;
  secrets: { ref: string; keys: string[] }[];
  recording: RecordingTarget | null;
  policy: { clipboardPaste: boolean; fileDownload: boolean };
  banner: string;
  kill: { natsSubject: string; heartbeatSeconds: number };
}

export type SessionEventType = 'started' | 'heartbeat' | 'ended' | 'recording_stored' | 'error';

export interface SessionEvent {
  sessionId: string;
  type: SessionEventType;
  at?: string;
  gatewayId?: string;
  bytesIn?: number;
  bytesOut?: number;
  reason?: string;
  recordingKey?: string;
  recordingSize?: number;
  error?: string;
  /** The asset's SSH host key (OpenSSH line), on started. */
  hostKey?: string;
  /** SHA256 fingerprint of hostKey as ssh-keygen prints it. */
  hostKeyFingerprint?: string;
}

export interface SessionEventAnswer {
  ok: boolean;
  action: 'continue' | 'kill';
  reason?: string;
  expiresAt?: string | null;
}

/** A refusal from the API: status and the error code (token_used, grant_expired, ...). */
export class ApiRefusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export interface GatewayApi {
  sessionCheck(req: SessionCheckRequest): Promise<SessionCheckAnswer>;
  sessionEvent(ev: SessionEvent): Promise<SessionEventAnswer>;
  secrets(sessionId: string, ref: string): Promise<{ ref: string; values: Record<string, string> }>;
  recordingUrl(sessionId: string): Promise<RecordingTarget>;
}

export class HttpGatewayApi implements GatewayApi {
  constructor(private readonly baseUrl: string, private readonly secret: string, private readonly timeoutMs = 15_000) {}

  sessionCheck(req: SessionCheckRequest) {
    return this.post<SessionCheckAnswer>('/internal/gateway/session-check', req);
  }

  sessionEvent(ev: SessionEvent) {
    return this.post<SessionEventAnswer>('/internal/gateway/session-events', ev);
  }

  secrets(sessionId: string, ref: string) {
    return this.post<{ ref: string; values: Record<string, string> }>('/internal/gateway/secrets', { sessionId, ref });
  }

  recordingUrl(sessionId: string) {
    return this.post<RecordingTarget>('/internal/gateway/recording-url', { sessionId });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-prgd-gateway-secret': this.secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await r.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (!r.ok) {
      const j = (json ?? {}) as { code?: string; error?: { code?: string; message?: string }; message?: string };
      const code = j.code ?? j.error?.code ?? `http_${r.status}`;
      const message = j.error?.message ?? j.message ?? text.slice(0, 200);
      throw new ApiRefusal(r.status, String(code), String(message));
    }
    return json as T;
  }
}
