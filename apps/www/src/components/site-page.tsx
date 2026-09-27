import { Footer, Header, LangProvider } from '@/components/marketing';
import type { Lang } from '@/lib/copy';

const UPDATED: Record<Lang, string> = { en: 'Last updated', tr: 'Son güncelleme', ar: 'آخر تحديث' };
const FALLBACK: Record<Lang, string> = { en: '', tr: 'Bu sayfanın Türkçesi hazırlanıyor; İngilizce sürümü geçerlidir.', ar: 'النسخة العربية من هذه الصفحة قيد الإعداد؛ النسخة الإنجليزية هي المعتمدة.' };

/** Shell for company and legal pages: site header, a reading column, site footer. */
export function SitePage({ lang, eyebrow, title, description, updated, html, fallback }: { lang: Lang; eyebrow?: string; title: string; description?: string; updated?: string; html: string; fallback?: boolean }) {
  return (
    <LangProvider lang={lang}>
      <Header />
      <main className="py-14">
        <article className="container-x prose-docs max-w-3xl">
          {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">{eyebrow}</p>}
          <h1>{title}</h1>
          {description && <p className="lead">{description}</p>}
          {updated && <p className="text-sm text-slate-500">{UPDATED[lang]}: {updated}</p>}
          {fallback && FALLBACK[lang] && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{FALLBACK[lang]}</p>}
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </article>
      </main>
      <Footer />
    </LangProvider>
  );
}
