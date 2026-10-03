import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SitePage } from '@/components/site-page';
import { getPage, LEGAL_SLUGS, PAGE_SLUGS } from '@/lib/pages';
import { getSite } from '@/lib/site';
import { alternatesFor } from '@/lib/alternates';
import type { Lang } from '@/lib/copy';

const LEGAL_EYEBROW: Record<Lang, string> = { en: 'Legal', tr: 'Hukuki', ar: 'قانوني' };
const LEGAL_INDEX: Record<Lang, { title: string; description: string }> = {
  en: { title: 'Legal documents', description: 'The agreement and policies that apply to Progrid services. You accept the Terms of service, the Acceptable use policy and the Privacy policy when you create an account.' },
  tr: { title: 'Hukuki belgeler', description: 'Progrid hizmetlerine uygulanan sözleşme ve politikalar. Hesap oluştururken Hizmet koşullarını, Kabul edilebilir kullanım politikasını ve Gizlilik politikasını kabul edersiniz.' },
  ar: { title: 'المستندات القانونية', description: 'الاتفاقية والسياسات التي تسري على خدمات Progrid. توافق على شروط الخدمة وسياسة الاستخدام المقبول وسياسة الخصوصية عند إنشاء حسابك.' },
};

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

/** /legal: every legal document of this storefront, with its summary. */
export async function legalIndexMetadata(lang: Lang): Promise<Metadata> {
  const site = await getSite();
  return { title: LEGAL_INDEX[lang].title, description: LEGAL_INDEX[lang].description, alternates: alternatesFor(site, lang, '/legal') };
}

export async function renderLegalIndex(lang: Lang) {
  const site = await getSite();
  const prefix = lang === 'en' ? '' : `/${lang}`;
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const items = LEGAL_SLUGS.map((slug) => ({ slug, page: getPage(site.site, lang, slug) })).filter((x) => x.page);
  const html = `<ul>${items.map(({ slug, page }) => `<li><a href="${prefix}/legal/${slug}"><strong>${esc(page!.title)}</strong></a><br />${esc(page!.description)}</li>`).join('')}</ul>`;
  return <SitePage lang={lang} eyebrow={LEGAL_EYEBROW[lang]} title={LEGAL_INDEX[lang].title} description={LEGAL_INDEX[lang].description} html={html} />;
}
