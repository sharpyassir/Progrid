import type { Metadata } from 'next';
import type { Lang } from './copy';
import type { SiteInfo } from './site-shared';

/**
 * Canonical and hreflang links. The website is one global site: every marketing page is canonical
 * on progrid.co, whichever domain served it. Legal documents are those of Progrid Arabia and are the
 * same on both domains, so every legal page is canonical on progrid.sa, the company's home domain.
 */
export function alternatesFor(site: SiteInfo, lang: Lang, path: string): Metadata['alternates'] {
  const p = path === '/' ? '' : path;
  const at = (www: string, l: Lang) => `${www}${l === 'en' ? '' : `/${l}`}${p}` || '/';
  const legal = path.startsWith('/legal');
  const own = legal ? site.saWww : site.globalWww;
  return {
    canonical: at(own, lang) || own,
    languages: {
      en: at(own, 'en') || own,
      ar: at(own, 'ar'),
      tr: at(own, 'tr'),
      'x-default': at(own, 'en') || own,
    },
  };
}
