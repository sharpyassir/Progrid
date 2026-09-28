import { hostname } from 'node:os';

/** Gateway settings, all from the environment. See README.md for the table. */
export interface GatewayConfig {
  /** Internal API base, without a trailing slash (http://api:4000). */
  apiUrl: string;
  /** Shared secret sent as X-Prgd-Gateway-Secret on every /internal/gateway call. */
  gatewaySecret: string;
  port: number;
  /** Reported to the API in session-check and events. */
  gatewayId: string;
  natsUrl: string;
  natsToken: string;
  /** OpenSSH known_hosts file; when set, host keys must match it (no trust on first use). */
  knownHostsFile: string;
  maxSessions: number;
  /** Exact Origin values allowed to open the WebSocket. */
  allowedOrigins: string[];
  /** Seconds the client has to send the auth frame. */
  authTimeoutSeconds: number;
  /** Seconds between WebSocket ping frames. */
  keepaliveSeconds: number;
  /** Default heartbeat interval when session-check does not say. */
  heartbeatSeconds: number;
  /** Where recordings are spooled while a session runs. */
  spoolDir: string;
  /** Notices before the grant expires, in seconds before the end (300 and 60). */
  expiryNoticeSeconds: number[];
  /** Seconds to wait for the SSH handshake. */
  sshReadyTimeoutSeconds: number;
  /** Trust X-Forwarded-For from the proxy in front (Caddy) for the client address. */
  trustProxy: boolean;
}

const int = (v: string | undefined, d: number, min = 0) => {
  if (v === undefined || v.trim() === '') return d;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new Error(`invalid number: ${v}`);
  return Math.floor(n);
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return {
    apiUrl: (env.PRGD_API_URL || 'http://api:4000').replace(/\/+$/, ''),
    gatewaySecret: env.PRGD_GATEWAY_SECRET ?? '',
    port: int(env.PRGD_GATEWAY_PORT, 4100),
    gatewayId: env.PRGD_GATEWAY_ID || hostname(),
    natsUrl: env.NATS_URL ?? '',
    natsToken: env.NATS_TOKEN ?? '',
    knownHostsFile: env.PRGD_GATEWAY_KNOWN_HOSTS ?? '',
    maxSessions: int(env.PRGD_GATEWAY_MAX_SESSIONS, 50, 1),
    allowedOrigins: (env.PRGD_GATEWAY_ALLOWED_ORIGINS || 'https://ops.progrid.sa')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    authTimeoutSeconds: int(env.PRGD_GATEWAY_AUTH_TIMEOUT_SECONDS, 5, 1),
    keepaliveSeconds: int(env.PRGD_GATEWAY_KEEPALIVE_SECONDS, 25, 1),
    heartbeatSeconds: int(env.PRGD_GATEWAY_HEARTBEAT_SECONDS, 30, 1),
    spoolDir: env.PRGD_GATEWAY_SPOOL_DIR ?? '',
    expiryNoticeSeconds: (env.PRGD_GATEWAY_EXPIRY_NOTICES || '300,60')
      .split(',')
      .map((v) => int(v, 0, 1))
      .filter((v) => v > 0)
      .sort((a, b) => b - a),
    sshReadyTimeoutSeconds: int(env.PRGD_GATEWAY_SSH_TIMEOUT_SECONDS, 15, 1),
    trustProxy: (env.PRGD_GATEWAY_TRUST_PROXY ?? 'true') !== 'false',
  };
}
