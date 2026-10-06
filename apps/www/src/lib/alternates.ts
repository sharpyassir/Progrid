import type { Metadata } from 'next';
import type { Lang } from './copy';
import type { SiteInfo } from './site-shared';

/**
 * Canonical and hreflang links. The website is one global site: every marketing page is canonical
 * on progrid.co, whichever domain served it. Legal documents differ per contracting company, so a
 * legal page is canonical on the domain that served it.
 */
export function alternatesFor(site: SiteInfo, lang: Lang, path: string): Metadata['alternates'] {
  const p = path === '/' ? '' : path;
  const at = (www: string, l: Lang) => `${www}${l === 'en' ? '' : `/${l}`}${p}` || '/';
  const legal = path.startsWith('/legal');
  const own = legal && site.site === 'sa' ? site.saWww : site.globalWww;
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
