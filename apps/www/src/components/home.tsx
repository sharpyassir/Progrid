import type { Metadata } from 'next';
import { Agents, AnnounceBar, Compare, Cta, Footer, Header, LangProvider, Marketplace, Pricing } from '@/components/marketing';
import { BuiltOn, Developers, HomeHero, PriceTeaser, Showcase, UseCases, Why } from '@/components/home-sections';
import { getCopy, type Lang } from '@/lib/copy';
import { getHomeCopy } from '@/lib/copy-home';
import { getSite } from '@/lib/site';
import { alternatesFor } from '@/lib/alternates';

export async function pageMetadata(lang: Lang): Promise<Metadata> {
  const site = await getSite();
  const c = getCopy(lang, site.site);
  return { title: c.meta.title, description: c.meta.description, alternates: alternatesFor(site, lang, '/'), openGraph: { title: 'Progrid', description: c.meta.description, type: 'website' } };
}

/** Homepage, in the order of a developer cloud landing page: hero, proof, products, why, AI, pricing, solutions, apps, developers. */
export function Home({ lang }: { lang: Lang }) {
  return (
    <LangProvider lang={lang}>
      <AnnounceBar />
      <Header />
      <main>
        <HomeHero />
        <BuiltOn />
        <Showcase />
        <Why />
        <Agents />
        <PriceTeaser />
        <UseCases />
        <Marketplace />
        <Developers />
        <Cta />
      </main>
      <Footer />
    </LangProvider>
  );
}

export async function pricingMetadata(lang: Lang): Promise<Metadata> {
  const site = await getSite();
  const p = getHomeCopy(lang).pricingPage;
  return { title: p.title, description: p.description, alternates: alternatesFor(site, lang, '/pricing') };
}

/** /pricing: the full price tables and the comparison, with the site header and footer. */
export function PricingPage({ lang }: { lang: Lang }) {
  const p = getHomeCopy(lang).pricingPage;
  return (
    <LangProvider lang={lang}>
      <AnnounceBar />
      <Header />
      <main>
        <Pricing page />
        <p className="container-x -mt-14 pb-6 text-xs text-slate-500">{p.calcNote}</p>
        <Compare />
        <Cta />
      </main>
      <Footer />
    </LangProvider>
  );
}
