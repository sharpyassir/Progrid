import type { Metadata } from 'next';
import type { Lang } from './copy';
import type { SiteInfo } from './site-shared';

/**
 * Canonical and hreflang links for a page that exists on both storefronts. `path` is the page
 * without a language prefix ("/", "/connect", "/legal/terms"). progrid.co is x-default; the
 * progrid.sa pages are tagged for Saudi Arabia (en-SA, ar-SA, tr-SA).
 */
export function alternatesFor(site: SiteInfo, lang: Lang, path: string): Metadata['alternates'] {
  const p = path === '/' ? '' : path;
  const at = (www: string, l: Lang) => `${www}${l === 'en' ? '' : `/${l}`}${p}` || '/';
  const own = site.site === 'sa' ? site.saWww : site.globalWww;
  return {
    canonical: at(own, lang) || own,
    languages: {
      en: at(site.globalWww, 'en') || site.globalWww,
      ar: at(site.globalWww, 'ar'),
      tr: at(site.globalWww, 'tr'),
      'en-SA': at(site.saWww, 'en') || site.saWww,
      'ar-SA': at(site.saWww, 'ar'),
      'tr-SA': at(site.saWww, 'tr'),
      'x-default': at(site.globalWww, 'en') || site.globalWww,
    },
  };
}
