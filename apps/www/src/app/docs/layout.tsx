import type { Metadata } from 'next';
import Link from 'next/link';
import { nav } from '@/lib/docs';
import { DocsNav } from '@/components/docs-nav';
import { getSite } from '@/lib/site';

export const metadata: Metadata = { title: { default: 'Docs', template: '%s · Progrid docs' } };

export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const groups = nav();
  const site = await getSite();
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="container-x flex h-14 items-center gap-4">
          <Link href="/" className="flex items-center gap-2.5 text-lg font-bold tracking-tight"><img src="/brand/progrid-mark.svg" width="22" height="28" alt="" aria-hidden /> Progrid</Link>
          <Link href="/docs" className="text-sm font-medium text-slate-600">Docs</Link>
          <div className="ms-auto flex items-center gap-4 text-sm">
            <Link href="/docs/api-reference" className="text-slate-600 hover:text-slate-900">API reference</Link>
            <a href={`${site.urls.console}/login`} className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-500">Console</a>
          </div>
        </div>
      </header>
      <div className="container-x grid gap-10 py-8 md:grid-cols-[220px_1fr]">
        <DocsNav groups={groups} />
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
