import type { Metadata } from 'next';
import { Agents, Compare, Cta, Footer, Header, Hero, LangProvider, Marketplace, Pricing, Products, TrustStrip } from '@/components/marketing';
import { COPY, type Lang } from '@/lib/copy';

export function pageMetadata(lang: Lang): Metadata {
  const c = COPY[lang];
  return { title: c.meta.title, description: c.meta.description, alternates: { languages: { en: '/', tr: '/tr', ar: '/ar' } }, openGraph: { title: 'Progrid', description: c.meta.description, type: 'website' } };
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
