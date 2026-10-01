/**
 * Removes known secret values (connection credentials, secret variables) from anything that
 * leaves a tool: the result the model sees, step payloads in logs, error messages. An API that
 * echoes its Authorization header back cannot leak the token this way.
 */
export class Redactor {
  private readonly values: string[] = [];

  add(...secrets: (string | undefined | null)[]) {
    for (const s of secrets) {
      if (typeof s !== 'string' || s.length < 4) continue;
      if (!this.values.includes(s)) this.values.push(s);
      // Common encodings of the same value.
      const b64 = Buffer.from(s).toString('base64');
      if (!this.values.includes(b64)) this.values.push(b64);
      const enc = encodeURIComponent(s);
      if (enc !== s && !this.values.includes(enc)) this.values.push(enc);
    }
    this.values.sort((a, b) => b.length - a.length);
  }

  text(s: string): string {
    let out = s;
    for (const v of this.values) if (out.includes(v)) out = out.split(v).join('[REDACTED]');
    return out;
  }

  /** Redacts every string inside a JSON value. */
  value<T>(v: T, depth = 0): T {
    if (!this.values.length || depth > 40) return v;
    if (typeof v === 'string') return this.text(v) as unknown as T;
    if (Array.isArray(v)) return v.map((x) => this.value(x, depth + 1)) as unknown as T;
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = this.value(x, depth + 1);
      return out as T;
    }
    return v;
  }
}

/** Per field cap for stored step payloads (input, output, error). */
export const STEP_FIELD_CAP = 64 * 1024;

/**
 * Keeps a JSON value under the cap. Larger values are replaced by a truncation marker with the
 * first part of their serialized form, so logs stay readable and the table stays small.
 */
export function capPayload(v: unknown, cap = STEP_FIELD_CAP): unknown {
  if (v === undefined) return null;
  let s: string;
  try {
    s = JSON.stringify(v);
  } catch {
    return { truncated: true, note: 'value could not be serialized' };
  }
  if (s === undefined) return null;
  if (s.length <= cap) return v;
  return { truncated: true, originalBytes: Buffer.byteLength(s), preview: s.slice(0, cap - 200) };
}

/** Shortens text for the model (tool results), keeping the start and noting the cut. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n[truncated: ${s.length - max} more characters]`;
}
