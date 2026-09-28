'use client';

import '@xterm/xterm/css/xterm.css';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import { post } from '@/lib/api';
import { decodeOutput, frame, inputFrame, isKnownReason, parseFrame, PING_MS, type TerminalPolicy } from '@/lib/terminal-protocol';
import type { Key } from '@/lib/i18n';
import type { TerminalOpen } from '@/lib/types';
import { useShell } from '@/components/ctx';
import { Countdown, ErrorNote, TicketLink } from '@/components/ui';

type Phase = 'opening' | 'connecting' | 'ready' | 'closed' | 'error';

/** Full screen browser terminal on an ACTIVE grant, through prgd-gateway. Every session is recorded. */
export default function TerminalPage() {
  return (
    <Suspense>
      <TerminalView />
    </Suspense>
  );
}

function TerminalView() {
  const { t, toast } = useShell();
  const grantId = useSearchParams().get('grant');
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<{ ws?: WebSocket; term?: Terminal; dispose?: number; started?: boolean; cleanup?: () => void }>({});
  const [phase, setPhase] = useState<Phase>('opening');
  const [info, setInfo] = useState<TerminalOpen | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [closedMessage, setClosedMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Refs for callbacks created once.
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    const l = live.current;
    const scheduleDispose = () => {
      // React strict mode unmounts and remounts once in development; only a real unmount closes the session.
      l.dispose = window.setTimeout(() => {
        l.cleanup?.();
        l.ws?.close(1000, 'client_closed');
        l.term?.dispose();
      }, 0);
    };
    if (l.dispose) {
      clearTimeout(l.dispose);
      l.dispose = undefined;
      return scheduleDispose;
    }
    if (l.started || !grantId) return scheduleDispose;
    l.started = true;
    void start(grantId);
    return scheduleDispose;

    async function start(id: string) {
      let s: TerminalOpen;
      try {
        s = await post<TerminalOpen>('/ops/v1/sessions', { grantId: id });
      } catch (e) {
        setError(e);
        setPhase('error');
        return;
      }
      setInfo(s);
      setExpiresAt(s.grant.expiresAt);
      let policy: TerminalPolicy = { ...s.policy };

      const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
      const term = new XTerm({
        cursorBlink: true,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: 14,
        scrollback: 5000,
        allowProposedApi: false,
        theme: { background: '#0a0a0a', foreground: '#e5e5e5', cursor: '#1bb9e0', selectionBackground: '#0b47c966' },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      l.term = term;
      if (!box.current) return;
      term.open(box.current);
      fit.fit();
      term.focus();

      // Paste goes through the terminal's own input handling; the policy can turn it off.
      const onPaste = (e: ClipboardEvent) => {
        if (policy.clipboardPaste) return;
        e.preventDefault();
        e.stopPropagation();
        toastRef.current(tRef.current('pasteBlocked'), 'error');
      };
      box.current.addEventListener('paste', onPaste, true);

      setPhase('connecting');
      const ws = new WebSocket(s.gatewayUrl);
      ws.binaryType = 'arraybuffer';
      l.ws = ws;
      let closed = false;
      let opened = false;
      const send = (f: Parameters<typeof frame>[0]) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame(f));
      };
      const end = (reason: string, message?: string) => {
        if (closed) return;
        closed = true;
        setClosedReason(reason);
        setClosedMessage(message ?? null);
        setPhase('closed');
        term.options.disableStdin = true;
        term.options.cursorBlink = false;
        // Terminal text stays ASCII: xterm.js does not shape right to left scripts.
        term.write(`\r\n\x1b[2m[session closed: ${reason}]\x1b[0m\r\n`);
      };

      // The first frame authenticates with the one time token and gives the terminal size.
      ws.onopen = () => {
        opened = true;
        send({ type: 'auth', token: s.token, cols: term.cols, rows: term.rows });
      };
      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(ev.data));
          return;
        }
        const f = parseFrame(ev.data);
        if (!f) return;
        switch (f.type) {
          case 'ready':
            setPhase('ready');
            if (f.expiresAt) setExpiresAt(f.expiresAt);
            if (f.policy) policy = { ...policy, ...f.policy };
            if (f.banner) term.write(`\x1b[2m${f.banner}\x1b[0m\r\n`);
            break;
          case 'output':
            term.write(decodeOutput(f.data));
            break;
          case 'notice':
            // Expiry warnings, extensions and sudo notices; an extension moves the countdown.
            if (f.expiresAt) setExpiresAt(f.expiresAt);
            toastRef.current(f.message, 'info');
            break;
          case 'closed':
            end(f.reason ?? 'closed', f.message);
            break;
        }
      };
      // No reconnect: a closed session stays closed; a new one needs a new token from the API.
      // Close codes carry the reason too (4001 authentication, 4003 refusals, 1000, 1011).
      ws.onclose = (ev) => end(ev.reason || (opened ? 'connection_lost' : 'connect_failed'));
      ws.onerror = () => undefined;

      const input = term.onData((d) => {
        if (!closed) send(inputFrame(d));
      });
      const resize = term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
      const refit = () => {
        try {
          fit.fit();
        } catch {
          /* the box is hidden */
        }
      };
      const observer = new ResizeObserver(refit);
      observer.observe(box.current);
      const ping = window.setInterval(() => send({ type: 'ping' }), PING_MS);
      const boxEl = box.current;
      l.cleanup = () => {
        clearInterval(ping);
        observer.disconnect();
        input.dispose();
        resize.dispose();
        boxEl.removeEventListener('paste', onPaste, true);
      };
    }
  }, [grantId]);

  // A translated message per known reason; otherwise the gateway's own text, or the bare reason.
  const closedText = !closedReason
    ? t('sessionClosed')
    : isKnownReason(closedReason)
      ? t(`termReason_${closedReason}` as Key)
      : closedMessage ?? t('sessionClosedReason', { reason: closedReason });
  const back = info?.ticket ? `/tickets/${info.ticket.id}` : '/access';

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-neutral-950 text-neutral-100">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-neutral-800 bg-neutral-900 px-4 py-2 text-sm">
        <Link href={back} className="text-neutral-400 hover:text-white"><span className="inline-block rtl:rotate-180">←</span> {t('back')}</Link>
        <span className="font-semibold">{info?.asset.name ?? '...'}</span>
        {info?.ticket && <span className="text-neutral-400">{t('ticket')} <TicketLink ticket={info.ticket} /></span>}
        <span className="flex items-center gap-1.5 text-neutral-400">
          {t('accessEndsIn')} <Countdown to={expiresAt} warnSeconds={600} calm="text-neutral-100 font-medium" />
        </span>
        <span className="ms-auto flex items-center gap-2 rounded bg-red-950/60 px-2 py-1 text-xs font-medium text-red-200" role="note">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
          {t('sessionRecorded')}
        </span>
        <span className={`badge ${phase === 'ready' ? 'bg-green-900/60 text-green-200' : phase === 'closed' || phase === 'error' ? 'bg-neutral-800 text-neutral-300' : 'bg-blue-900/60 text-blue-200'}`}>{t(`term_${phase}`)}</span>
      </header>
      {phase === 'error' && (
        <div className="p-4">
          <ErrorNote error={error} />
          <p className="mt-3 text-sm"><Link className="text-blue-400 hover:underline" href="/access">{t('backToAccess')}</Link></p>
        </div>
      )}
      {!grantId && <div className="p-4"><ErrorNote error={new Error(t('noGrantChosen'))} /></div>}
      {phase === 'closed' && (
        <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-4 py-2 text-sm" role="status">
          <span>{closedText}</span>
          <Link className="btn-ghost border-neutral-700 py-1" href={back}>{info?.ticket ? t('backToTicket') : t('backToAccess')}</Link>
        </div>
      )}
      {/* Terminal output is always left to right, whatever the page language. xterm.js parks its
          helper elements far off screen; clipping here keeps a right to left page from scrolling to them. */}
      <div dir="ltr" className="relative min-h-0 flex-1 overflow-hidden p-2">
        <div ref={box} className="h-full w-full" data-testid="terminal" />
      </div>
      <footer className="border-t border-neutral-800 px-4 py-1.5 text-xs text-neutral-500">{t('terminalFooter')}</footer>
    </div>
  );
}

