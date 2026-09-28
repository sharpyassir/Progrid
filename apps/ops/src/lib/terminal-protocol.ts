/**
 * The prgd-gateway WebSocket protocol (services/prgd-gateway, docs/devops-console.md).
 *
 * The browser opens `gatewayUrl` from POST /ops/v1/sessions; every frame is JSON text.
 *   client: {"type":"auth","token","cols","rows"} within 5 seconds, then
 *           {"type":"input","data"}, {"type":"resize","cols","rows"}, {"type":"ping"}
 *   server: {"type":"ready","sessionId","expiresAt","banner","policy","asset","ticket","recorded"},
 *           {"type":"output","data"}, {"type":"notice","message","expiresAt"?}, {"type":"pong"},
 *           {"type":"closed","reason","message"?} as the last frame.
 *
 * Input is the UTF-8 string xterm.js hands out; output is base64 of the raw bytes, written to
 * xterm.js as a Uint8Array so multi byte characters split across frames still decode. Change
 * the two encodings here if the gateway ever changes; nothing else depends on them.
 */
export const TERMINAL_INPUT_ENCODING: 'utf8' | 'base64' = 'utf8';
export const TERMINAL_OUTPUT_ENCODING: 'utf8' | 'base64' = 'base64';

export interface TerminalPolicy { clipboardPaste: boolean; fileDownload: boolean }

export type ClientFrame =
  | { type: 'auth'; token: string; cols?: number; rows?: number }
  | { type: 'input'; data: string; encoding?: 'base64' }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ping' };

export type ServerFrame =
  | { type: 'ready'; sessionId?: string; expiresAt?: string; banner?: string; policy?: Partial<TerminalPolicy>; recorded?: boolean }
  | { type: 'output'; data: string }
  | { type: 'notice'; message: string; expiresAt?: string }
  | { type: 'closed'; reason?: string; message?: string }
  | { type: 'pong' };

const utf8 = new TextEncoder();

/** An input frame for keystrokes or pasted text. */
export function inputFrame(text: string): ClientFrame {
  if (TERMINAL_INPUT_ENCODING === 'utf8') return { type: 'input', data: text };
  let bin = '';
  for (const b of utf8.encode(text)) bin += String.fromCharCode(b);
  return { type: 'input', data: btoa(bin), encoding: 'base64' };
}

/** Output for xterm.js: the decoded bytes (xterm decodes UTF-8 across chunks), or text as is. */
export function decodeOutput(data: string): string | Uint8Array {
  if (TERMINAL_OUTPUT_ENCODING === 'utf8') return data;
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function parseFrame(raw: unknown): ServerFrame | null {
  if (typeof raw !== 'string') return null;
  try {
    const f = JSON.parse(raw) as ServerFrame;
    return f && typeof f === 'object' && typeof f.type === 'string' ? f : null;
  } catch {
    return null;
  }
}

export const frame = (f: ClientFrame) => JSON.stringify(f);

/** Application level keepalive (the gateway also pings at the WebSocket level every 25 seconds). */
export const PING_MS = 25_000;

/**
 * Reasons the gateway gives in the closed frame or the close code's reason: 4001 authentication,
 * 4003 session check refusals (the API code), 1000 normal ends, 1011 errors. Each has a
 * translated message `termReason_<reason>`; anything else shows the gateway's own text.
 */
export const KNOWN_CLOSE_REASONS = [
  'auth_timeout', 'auth_required', 'bad_frame', 'token_invalid', 'token_used', 'token_expired',
  'grant_expired', 'grant_inactive', 'session_killed', 'residency_blocked', 'engineer_inactive', 'forbidden', 'asset_unavailable',
  'killed', 'ssh_closed', 'client_closed', 'error', 'api_unavailable', 'connection_lost', 'connect_failed',
] as const;
export type CloseReason = (typeof KNOWN_CLOSE_REASONS)[number];
export const isKnownReason = (r: string): r is CloseReason => (KNOWN_CLOSE_REASONS as readonly string[]).includes(r);
