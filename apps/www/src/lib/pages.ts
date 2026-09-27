import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import type { Lang } from './copy';

export interface SitePageData { slug: string; lang: Lang; title: string; description: string; updated: string; html: string; fallback: boolean }

/** Static company and legal pages: content/pages/<lang>/<slug>.md, English when a language has no version yet. */
export const PAGE_SLUGS = ['contact', 'careers'] as const;
export const LEGAL_SLUGS = ['terms', 'acceptable-use', 'privacy', 'refunds', 'sla', 'cookies'] as const;

const DIR = join(process.cwd(), 'content/pages');

export function getPage(lang: Lang, slug: string): SitePageData | undefined {
  const own = join(DIR, lang, `${slug}.md`);
  const file = existsSync(own) ? own : join(DIR, 'en', `${slug}.md`);
  if (!existsSync(file)) return undefined;
  const raw = readFileSync(file, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const meta: Record<string, string> = {};
  if (m) for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  const html = marked.parse(m ? m[2] : raw, { gfm: true }) as string;
  return { slug, lang, title: meta.title ?? slug, description: meta.description ?? '', updated: meta.updated ?? '', html, fallback: file !== own };
}

export function langPrefix(lang: Lang) {
  return lang === 'en' ? '' : `/${lang}`;
}
