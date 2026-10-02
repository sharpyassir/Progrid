import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SitePage } from '@/components/site-page';
import { getPage, LEGAL_SLUGS, PAGE_SLUGS } from '@/lib/pages';
import { getSite } from '@/lib/site';
import { alternatesFor } from '@/lib/alternates';
import type { Lang } from '@/lib/copy';

const LEGAL_EYEBROW: Record<Lang, string> = { en: 'Legal', tr: 'Hukuki', ar: 'قانوني' };

/** Builders the thin route files call, so every language shares one implementation. */
export function pageParams(kind: 'page' | 'legal') {
  return (kind === 'page' ? PAGE_SLUGS : LEGAL_SLUGS).map((slug) => ({ slug }));
}

export async function pageMetadataFor(lang: Lang, slug: string, kind: 'page' | 'legal' = 'page'): Promise<Metadata> {
  const site = await getSite();
  const p = getPage(site.site, lang, slug);
  return { title: p?.title, description: p?.description, alternates: alternatesFor(site, lang, kind === 'legal' ? `/legal/${slug}` : `/${slug}`) };
}

/** The page of this storefront: legal documents name the company of the domain (progrid.co or progrid.sa). */
export async function renderPage(lang: Lang, kind: 'page' | 'legal', slug: string) {
  const allowed = (kind === 'page' ? PAGE_SLUGS : LEGAL_SLUGS) as readonly string[];
  const site = await getSite();
  const p = allowed.includes(slug) ? getPage(site.site, lang, slug) : undefined;
  if (!p) notFound();
  return <SitePage lang={lang} eyebrow={kind === 'legal' ? LEGAL_EYEBROW[lang] : undefined} title={p.title} description={p.description} updated={p.updated} html={p.html} fallback={p.fallback} />;
}
