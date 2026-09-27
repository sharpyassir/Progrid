import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SitePage } from '@/components/site-page';
import { getPage, LEGAL_SLUGS, PAGE_SLUGS } from '@/lib/pages';
import type { Lang } from '@/lib/copy';

const LEGAL_EYEBROW: Record<Lang, string> = { en: 'Legal', tr: 'Hukuki', ar: 'قانوني' };

/** Builders the thin route files call, so every language shares one implementation. */
export function pageParams(kind: 'page' | 'legal') {
  return (kind === 'page' ? PAGE_SLUGS : LEGAL_SLUGS).map((slug) => ({ slug }));
}

export function pageMetadataFor(lang: Lang, slug: string): Metadata {
  const p = getPage(lang, slug);
  return { title: p?.title, description: p?.description };
}

export function renderPage(lang: Lang, kind: 'page' | 'legal', slug: string) {
  const allowed = (kind === 'page' ? PAGE_SLUGS : LEGAL_SLUGS) as readonly string[];
  const p = allowed.includes(slug) ? getPage(lang, slug) : undefined;
  if (!p) notFound();
  return <SitePage lang={lang} eyebrow={kind === 'legal' ? LEGAL_EYEBROW[lang] : undefined} title={p.title} description={p.description} updated={p.updated} html={p.html} fallback={p.fallback} />;
}
