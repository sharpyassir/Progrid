import WebSocket from 'ws';

export const ORIGIN = 'https://ops.test';

export interface Frame {
  type: string;
  [k: string]: unknown;
}

/** A browser stand in: collects frames, decodes output, waits for conditions. */
export class TestClient {
  readonly ws: WebSocket;
  readonly frames: Frame[] = [];
  readonly opened: Promise<void>;
  readonly closed: Promise<{ code: number; reason: string }>;
  upgradeStatus: number | null = null;
  private waiters: (() => void)[] = [];

  constructor(url: string, origin = ORIGIN) {
    this.ws = new WebSocket(url, { origin });
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('unexpected-response', (_req, res) => {
        this.upgradeStatus = res.statusCode ?? 0;
        reject(new Error(`upgrade refused ${res.statusCode}`));
      });
      this.ws.once('error', reject);
    });
    this.opened.catch(() => undefined);
    this.closed = new Promise((resolve) => this.ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
    this.ws.on('message', (d) => {
      this.frames.push(JSON.parse(d.toString()));
      this.notify();
    });
    this.ws.on('close', () => this.notify());
  }

  private notify() {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  send(frame: Frame) {
    this.ws.send(JSON.stringify(frame));
  }

  type(text: string) {
    this.send({ type: 'input', data: text });
  }

  /** Everything the terminal showed, decoded. */
  get output() {
    return Buffer.concat(this.frames.filter((f) => f.type === 'output').map((f) => Buffer.from(String(f.data), 'base64'))).toString('utf8');
  }

  frame(type: string) {
    return this.frames.find((f) => f.type === type);
  }

  async waitFor(cond: () => boolean, what: string, ms = 10_000) {
    const until = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > until) throw new Error(`timed out waiting for ${what}; frames: ${JSON.stringify(this.frames).slice(-2000)}`);
      await new Promise<void>((r) => {
        const t = setTimeout(r, 50);
        this.waiters.push(() => {
          clearTimeout(t);
          r();
        });
      });
    }
  }

  waitOutput(text: string, ms?: number) {
    return this.waitFor(() => this.output.includes(text), `output ${JSON.stringify(text)}`, ms);
  }

  waitFrame(type: string, ms?: number) {
    return this.waitFor(() => !!this.frame(type), `a ${type} frame`, ms).then(() => this.frame(type)!);
  }
}

export async function until(cond: () => boolean, what: string, ms = 10_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
