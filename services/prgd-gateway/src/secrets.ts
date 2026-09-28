/**
 * Keeps secret values out of what the engineer sees and out of the recording.
 *
 * Redactor: every output byte passes through it before it goes to the browser or the recorder.
 * Any occurrence of a secret value is replaced with "********". Because a value can be split
 * across two SSH packets, the last (longest secret - 1) bytes are held back until the next chunk
 * or a short idle flush.
 *
 * SudoResponder: when the output ends with a sudo password prompt for the login user, the gateway
 * types the stored sudo_password into the shell itself. With a pty sudo turns echo off, so the
 * value is never printed; the redactor catches it if something echoes it anyway.
 */

export const REDACTED = Buffer.from('********');
/** Values shorter than this are not redacted (they would mangle ordinary output). */
export const MIN_REDACT_LENGTH = 4;

export class Redactor {
  private readonly secrets: Buffer[];
  private readonly hold: number;
  private held = Buffer.alloc(0);

  constructor(values: string[]) {
    this.secrets = values.map((v) => Buffer.from(v, 'utf8')).filter((b) => b.length >= MIN_REDACT_LENGTH);
    this.hold = this.secrets.reduce((m, b) => Math.max(m, b.length - 1), 0);
  }

  get active() {
    return this.secrets.length > 0;
  }

  private scrub(buf: Buffer) {
    for (const s of this.secrets) {
      let i = buf.indexOf(s);
      while (i !== -1) {
        buf = Buffer.concat([buf.subarray(0, i), REDACTED, buf.subarray(i + s.length)]);
        i = buf.indexOf(s, i + REDACTED.length);
      }
    }
    return buf;
  }

  /** Returns what can be shown now; keeps back a possible partial secret. */
  push(chunk: Buffer): Buffer {
    if (!this.active) return chunk;
    const all = this.scrub(Buffer.concat([this.held, chunk]));
    const keep = Math.min(this.hold, all.length);
    this.held = Buffer.from(all.subarray(all.length - keep));
    return all.subarray(0, all.length - keep);
  }

  /** Releases what was held back (nothing more arrived). */
  flush(): Buffer {
    const out = this.held;
    this.held = Buffer.alloc(0);
    return out;
  }

  get pending() {
    return this.held.length;
  }
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const WRONG = /Sorry, try again|incorrect password attempt/;
const PROMPT = /\[sudo\] password for ([^\s:]{1,64}):\s*$/;

export type SudoDecision = { type: 'none' } | { type: 'inject'; value: string } | { type: 'give_up' };

/**
 * Watches output for "[sudo] password for <user>:" at the very end of what the shell printed and
 * answers it. If sudo then says the password was wrong ("Sorry, try again."), it stops for the
 * rest of the session so a wrong stored value cannot lock the account; the prompt stays on screen.
 */
export class SudoResponder {
  private tail = '';
  private awaitingVerdict = false;
  private stopped = false;
  injections = 0;

  constructor(private readonly username: string, private readonly password: string | undefined) {}

  get enabled() {
    return !!this.password && !this.stopped;
  }

  /** Feed raw shell output; returns what to do. */
  observe(chunk: Buffer): SudoDecision {
    if (!this.password || this.stopped) return { type: 'none' };
    this.tail = (this.tail + chunk.toString('utf8')).slice(-512);
    const text = this.tail.replace(ANSI, '');
    if (this.awaitingVerdict && WRONG.test(text)) {
      this.stopped = true;
      this.tail = '';
      return { type: 'give_up' };
    }
    const m = PROMPT.exec(text);
    if (!m || m[1] !== this.username) {
      // Any other output after an answer means sudo took it.
      if (this.awaitingVerdict && /\S/.test(text)) this.awaitingVerdict = false;
      return { type: 'none' };
    }
    this.tail = '';
    this.awaitingVerdict = true;
    this.injections += 1;
    return { type: 'inject', value: this.password };
  }
}
