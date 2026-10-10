import type { Metadata } from 'next';
import './globals.css';
import { SiteProvider } from '@/components/site-context';
import { getSite } from '@/lib/site';
import { LEGAL_NAME } from '@/lib/site-shared';
import { getCopy } from '@/lib/copy';
import { RefBeacon } from '@/components/ref-beacon';

/** Every page depends on the Host (progrid.co or progrid.sa), so nothing is prerendered at build time. */
export const dynamic = 'force-dynamic';

/** Defaults per storefront; pages override title and description. Absolute URLs use this host. */
export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  const c = getCopy('en', site.site);
  return {
    metadataBase: new URL(site.urls.www),
    title: c.meta.title,
    description: c.meta.description,
    icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon-64.png', sizes: '64x64', type: 'image/png' }], apple: '/apple-touch-icon.png' },
    openGraph: { title: 'Progrid', description: c.footer.tagline, type: 'website', images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Progrid Cloud' }] },
    twitter: { card: 'summary_large_image', images: ['/og-image.png'] },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The storefront (progrid.co or progrid.sa) and its addresses come from the Host of each request.
  const site = await getSite();
  // Organization data for search engines: one company, Progrid Arabia, on both domains. No registration
  // numbers or street address until they are published.
  const org = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Progrid',
    legalName: LEGAL_NAME,
    alternateName: 'بروجريد العربية',
    url: site.globalWww,
    logo: `${site.globalWww}/icon-512.png`,
    email: site.entity.supportEmail,
    address: { '@type': 'PostalAddress', addressLocality: 'Riyadh', addressCountry: 'SA' },
    sameAs: [site.saWww],
  };
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(org).replace(/</g, '\\u003c') }} />
      </head>
      <body>
        <SiteProvider value={site}>
          <RefBeacon />
          {children}
        </SiteProvider>
      </body>
    </html>
  );
}
