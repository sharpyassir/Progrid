import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import type { Lang } from './copy';
import type { Site } from './site-shared';

export interface SitePageData { slug: string; lang: Lang; title: string; description: string; updated: string; html: string; fallback: boolean }

/** Static company and legal pages. */
export const PAGE_SLUGS = ['contact', 'careers'] as const;
/** Order is the order of the legal index page (/legal). */
export const LEGAL_SLUGS = ['terms', 'acceptable-use', 'privacy', 'dpa', 'subprocessors', 'refunds', 'sla', 'cookies', 'copyright', 'law-enforcement', 'export-sanctions'] as const;

/**
 * Pages live in content/pages/<dir>/<lang>/<slug>.md:
 *  - sa: the legal documents of Progrid Arabia, the one company behind both domains, governed by
 *    Saudi law. progrid.co and progrid.sa serve the same documents (the folder name is historical).
 *  - shared: company pages and documents without a contracting party, with {{tokens}} for the
 *    company details.
 * Each page is read from the legal directory first, then the shared one. A language without a
 * version falls back to English of the same directory (flagged); Turkish always does.
 */
const DIR = join(process.cwd(), 'content/pages');
const PAGE_DIRS = ['sa', 'shared'];

/** Progrid Arabia on both domains; only the support mailbox follows the domain. */
const companyBlock = (email: string): Record<Lang, string> => ({
  en: `Progrid Arabia (بروجريد العربية)  \nRiyadh, Kingdom of Saudi Arabia  \n**${email}**\n\nProgrid Arabia provides the Services on progrid.co and progrid.sa. Commercial registration and VAT numbers will be published on this page once registration is complete.`,
  tr: `Progrid Arabia (بروجريد العربية)  \nRiyadh, Kingdom of Saudi Arabia  \n**${email}**`,
  ar: `بروجريد العربية (Progrid Arabia)  \nالرياض، المملكة العربية السعودية  \n**${email}**\n\nتقدّم بروجريد العربية الخدمات على progrid.co وprogrid.sa. ويُنشر رقم السجل التجاري والرقم الضريبي في هذه الصفحة فور اكتمال التسجيل.`,
});

function tokensFor(email: string): Record<Lang, Record<string, string>> {
  const block = companyBlock(email);
  return {
    en: { support_email: email, privacy_law: 'the Personal Data Protection Law and other data protection laws that apply', company_block: block.en },
    tr: { support_email: email, privacy_law: 'the Personal Data Protection Law and other data protection laws that apply', company_block: block.tr },
    ar: { support_email: email, privacy_law_ar: 'نظام حماية البيانات الشخصية وغيره من قوانين حماية البيانات المعمول بها', company_block: block.ar },
  };
}

const TOKENS: Record<Site, Record<Lang, Record<string, string>>> = {
  global: tokensFor('support@progrid.co'),
  sa: tokensFor('support@progrid.sa'),
};

function find(lang: Lang, slug: string): { file: string; fallback: boolean } | undefined {
  for (const dir of PAGE_DIRS) {
    const own = join(DIR, dir, lang, `${slug}.md`);
    if (existsSync(own)) return { file: own, fallback: false };
    const en = join(DIR, dir, 'en', `${slug}.md`);
    if (existsSync(en)) return { file: en, fallback: lang !== 'en' };
  }
  return undefined;
}

export function getPage(site: Site, lang: Lang, slug: string): SitePageData | undefined {
  const found = find(lang, slug);
  if (!found) return undefined;
  const tokens = TOKENS[site][found.fallback ? 'en' : lang];
  const raw = readFileSync(found.file, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k: string) => tokens[k] ?? TOKENS[site].en[k] ?? m);
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const meta: Record<string, string> = {};
  if (m) for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  const html = marked.parse(m ? m[2] : raw, { gfm: true }) as string;
  return { slug, lang, title: meta.title ?? slug, description: meta.description ?? '', updated: meta.updated ?? '', html, fallback: found.fallback };
}

export function langPrefix(lang: Lang) {
  return lang === 'en' ? '' : `/${lang}`;
}
