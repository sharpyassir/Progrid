import type { Metadata } from 'next';
import { Agents, Compare, Cta, Footer, Header, Hero, LangProvider, Marketplace, Pricing, Products, TrustStrip } from '@/components/marketing';
import { getCopy, type Lang } from '@/lib/copy';
import { getSite } from '@/lib/site';
import { alternatesFor } from '@/lib/alternates';

export async function pageMetadata(lang: Lang): Promise<Metadata> {
  const site = await getSite();
  const c = getCopy(lang, site.site);
  return { title: c.meta.title, description: c.meta.description, alternates: alternatesFor(site, lang, '/'), openGraph: { title: 'Progrid', description: c.meta.description, type: 'website' } };
}


export function Home({ lang }: { lang: Lang }) {
  return (
    <LangProvider lang={lang}>
      <Header />
      <main>
        <Hero />
        <TrustStrip />
        <Products />
        <Agents />
        <Pricing />
        <Marketplace />
        <Compare />
        <Cta />
      </main>
      <Footer />
    </LangProvider>
  );
}
