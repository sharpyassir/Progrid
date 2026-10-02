import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { allDocs, getDoc } from '@/lib/docs';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const d = getDoc((await params).slug);
  return { title: d?.title, description: d?.description };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();
  const docs = allDocs();
  const i = docs.findIndex((d) => d.slug === slug);
  const prev = docs[i - 1], next = docs[i + 1];
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_180px]">
      <article className="prose-docs min-w-0 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">{doc.section}</p>
        <h1>{doc.title}</h1>
        <p className="lead">{doc.description}</p>
        <div dangerouslySetInnerHTML={{ __html: doc.html }} />
        <div className="mt-12 flex justify-between border-t border-slate-200 pt-6 text-sm">
          {prev ? <Link href={`/docs/${prev.slug}`} className="text-blue-600 hover:underline">← {prev.title}</Link> : <span />}
          {next ? <Link href={`/docs/${next.slug}`} className="text-blue-600 hover:underline">{next.title} →</Link> : <Link href="/docs/api-reference" className="text-blue-600 hover:underline">API reference →</Link>}
        </div>
      </article>
      {doc.headings.length > 1 && (
        <aside className="hidden lg:block">
          <div className="sticky top-20 text-sm">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">On this page</div>
            <ul className="space-y-1">{doc.headings.map((h) => <li key={h.id}><a href={`#${h.id}`} className="text-slate-600 hover:text-slate-900">{h.text}</a></li>)}</ul>
          </div>
        </aside>
      )}
    </div>
  );
}
