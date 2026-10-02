import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import type { Lang } from './copy';
import type { Site } from './site-shared';

export interface SitePageData { slug: string; lang: Lang; title: string; description: string; updated: string; html: string; fallback: boolean }

/** Static company and legal pages. */
export const PAGE_SLUGS = ['contact', 'careers'] as const;
export const LEGAL_SLUGS = ['terms', 'acceptable-use', 'privacy', 'refunds', 'sla', 'cookies'] as const;

/**
 * Pages live in content/pages/<dir>/<lang>/<slug>.md:
 *  - sa: Progrid Arabia's legal documents (progrid.sa), governed by Saudi law.
 *  - co: Progrid Technologies LLC's legal documents (progrid.co).
 *  - shared: pages that are the same on both sites, with {{tokens}} for the company details.
 * A storefront reads its own directory first, then the shared one. A language without a version
 * falls back to English of the same directory (flagged), never to the other company's document.
 */
const DIR = join(process.cwd(), 'content/pages');
const SITE_DIR: Record<Site, string> = { global: 'co', sa: 'sa' };

const TOKENS: Record<Site, Record<Lang, Record<string, string>>> = {
  global: {
    en: { support_email: 'support@progrid.co', privacy_law: 'applicable data protection law', company_block: 'Progrid Technologies LLC  \nUnited States  \n**support@progrid.co**\n\nThe registered address and EIN will be published on this page once registration is complete. Customers whose billing country is Saudi Arabia contract with Progrid Arabia at [progrid.sa](https://progrid.sa/contact).' },
    tr: { support_email: 'support@progrid.co', privacy_law: 'applicable data protection law', company_block: 'Progrid Technologies LLC  \nUnited States  \n**support@progrid.co**' },
    ar: { support_email: 'support@progrid.co', privacy_law_ar: 'قوانين حماية البيانات المعمول بها', company_block: 'Progrid Technologies LLC  \nالولايات المتحدة  \n**support@progrid.co**\n\nيُنشر العنوان المسجل ورقم التعريف الضريبي (EIN) في هذه الصفحة بعد اكتمال التسجيل. ويتعاقد العملاء الذين بلد الفوترة لديهم هو المملكة العربية السعودية مع Progrid Arabia عبر [progrid.sa](https://progrid.sa/ar/contact).' },
  },
  sa: {
    en: { support_email: 'support@progrid.sa', privacy_law: 'the Personal Data Protection Law', company_block: 'Progrid Arabia (بروجريد العربية)  \nRiyadh, Kingdom of Saudi Arabia  \n**support@progrid.sa**\n\nCommercial registration and VAT numbers will be published on this page once registration is complete.' },
    tr: { support_email: 'support@progrid.sa', privacy_law: 'the Personal Data Protection Law', company_block: 'Progrid Arabia (بروجريد العربية)  \nRiyadh, Kingdom of Saudi Arabia  \n**support@progrid.sa**' },
    ar: { support_email: 'support@progrid.sa', privacy_law_ar: 'نظام حماية البيانات الشخصية', company_block: 'بروجريد العربية (Progrid Arabia)  \nالرياض، المملكة العربية السعودية  \n**support@progrid.sa**\n\nيُنشر رقم السجل التجاري والرقم الضريبي في هذه الصفحة فور اكتمال التسجيل.' },
  },
};

function find(site: Site, lang: Lang, slug: string): { file: string; fallback: boolean } | undefined {
  for (const dir of [SITE_DIR[site], 'shared']) {
    const own = join(DIR, dir, lang, `${slug}.md`);
    if (existsSync(own)) return { file: own, fallback: false };
    const en = join(DIR, dir, 'en', `${slug}.md`);
    if (existsSync(en)) return { file: en, fallback: lang !== 'en' };
  }
  return undefined;
}

export function getPage(site: Site, lang: Lang, slug: string): SitePageData | undefined {
  const found = find(site, lang, slug);
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
