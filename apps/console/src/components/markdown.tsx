import { Fragment, type ReactNode } from 'react';

/**
 * A small Markdown renderer for runbooks: headings, paragraphs, lists, block quotes, fenced
 * code, rules, inline code, bold, italic and links. It builds React elements, never HTML
 * strings, so the text cannot inject markup.
 */
export function Markdown({ source }: { source: string }) {
  return <div className="space-y-3 text-sm leading-relaxed">{blocks(source)}</div>;
}

function blocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(<pre key={out.length} dir="ltr" className="overflow-x-auto rounded bg-neutral-950 p-3 font-mono text-xs text-neutral-100">{body.join('\n')}</pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const size = ['text-xl', 'text-lg', 'text-base', 'text-sm', 'text-sm', 'text-sm'][h[1].length - 1];
      const Tag = `h${Math.min(h[1].length + 1, 6)}` as 'h2';
      out.push(<Tag key={out.length} className={`${size} font-semibold`}>{inline(h[2])}</Tag>);
      i++;
      continue;
    }
    if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) { out.push(<hr key={out.length} className="border-neutral-200 dark:border-neutral-800" />); i++; continue; }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(<blockquote key={out.length} className="space-y-2 border-s-4 border-neutral-300 ps-3 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">{blocks(body.join('\n'))}</blockquote>);
      continue;
    }
    const ul = /^\s*[-*+]\s+/, ol = /^\s*\d+[.)]\s+/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line);
      const re = ordered ? ol : ul;
      const items: string[] = [];
      while (i < lines.length && (re.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (re.test(lines[i])) items.push(lines[i].replace(re, ''));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      const cls = `space-y-1 ps-5 ${ordered ? 'list-decimal' : 'list-disc'}`;
      const lis = items.map((it, k) => {
        const task = /^\[([ xX])\]\s+(.*)$/.exec(it);
        return <li key={k}>{task ? <><input type="checkbox" readOnly checked={task[1] !== ' '} className="me-1 align-middle" />{inline(task[2])}</> : inline(it)}</li>;
      });
      out.push(ordered ? <ol key={out.length} className={cls}>{lis}</ol> : <ul key={out.length} className={cls}>{lis}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|\s*~~~|\s*>|\s*[-*+]\s+|\s*\d+[.)]\s+)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    out.push(<p key={out.length}>{inline(para.join(' '))}</p>);
  }
  return out;
}

/** Inline code, links, bold and italic. */
function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (m[1]) parts.push(<code key={m.index} dir="ltr" className="rounded bg-neutral-100 px-1 font-mono text-xs dark:bg-neutral-800">{tok.slice(1, -1)}</code>);
    else if (m[2]) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const safe = /^(https?:\/\/|\/|#|mailto:)/i.test(href);
      parts.push(safe ? <a key={m.index} href={href} className="text-blue-600 hover:underline" target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{label}</a> : label);
    } else if (m[3]) parts.push(<strong key={m.index}>{inline(tok.slice(2, -2))}</strong>);
    else parts.push(<em key={m.index}>{inline(tok.slice(1, -1))}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.map((p, k) => <Fragment key={k}>{p}</Fragment>);
}
