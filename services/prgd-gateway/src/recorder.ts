import { createReadStream, createWriteStream, mkdtempSync, rmSync, statSync, type WriteStream } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/**
 * asciicast v2 recorder. The file is written to a private temporary directory while the session
 * runs: a header line, then one JSON array per event, [seconds, "o", text] for terminal output and
 * [seconds, "r", "COLSxROWS"] for resizes. Input is not recorded, and neither is anything the
 * gateway types for the engineer (secrets): only output, after redaction, reaches the file.
 */
export class AsciicastRecorder {
  readonly path: string;
  private readonly dir: string;
  private readonly out: WriteStream;
  private readonly decoder = new StringDecoder('utf8');
  private readonly started = process.hrtime.bigint();
  private closed: Promise<void> | null = null;

  constructor(opts: { width: number; height: number; title: string; spoolDir?: string; env?: Record<string, string> }) {
    this.dir = mkdtempSync(join(opts.spoolDir || tmpdir(), 'prgd-rec-'));
    this.path = join(this.dir, 'session.cast');
    this.out = createWriteStream(this.path, { mode: 0o600 });
    const header = {
      version: 2,
      width: opts.width,
      height: opts.height,
      timestamp: Math.floor(Date.now() / 1000),
      env: opts.env ?? { SHELL: '/bin/bash', TERM: 'xterm-256color' },
      title: opts.title,
    };
    this.out.write(JSON.stringify(header) + '\n');
  }

  private elapsed() {
    return Math.round(Number(process.hrtime.bigint() - this.started) / 1e3) / 1e6;
  }

  output(chunk: Buffer) {
    if (this.closed) return;
    const text = this.decoder.write(chunk);
    if (text) this.out.write(JSON.stringify([this.elapsed(), 'o', text]) + '\n');
  }

  resize(cols: number, rows: number) {
    if (this.closed) return;
    this.out.write(JSON.stringify([this.elapsed(), 'r', `${cols}x${rows}`]) + '\n');
  }

  /** Flushes and closes the file; resolves with its size in bytes. */
  async close(): Promise<number> {
    if (!this.closed) {
      const rest = this.decoder.end();
      if (rest) this.out.write(JSON.stringify([this.elapsed(), 'o', rest]) + '\n');
      this.closed = new Promise((resolve, reject) => {
        this.out.once('error', reject);
        this.out.end(() => resolve());
      });
    }
    await this.closed;
    return statSync(this.path).size;
  }

  /** Removes the temporary directory and the file in it. */
  discard() {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/** PUTs a file to a presigned URL with an explicit Content-Length (S3 refuses chunked bodies). */
export function putFile(url: string, file: string, contentType: string, timeoutMs = 120_000): Promise<number> {
  const size = statSync(file).size;
  const u = new URL(url);
  const request = u.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(u, { method: 'PUT', headers: { 'content-type': contentType, 'content-length': size }, timeout: timeoutMs }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('timeout', () => req.destroy(new Error('upload timed out')));
    req.on('error', reject);
    createReadStream(file).on('error', reject).pipe(req);
  });
}
