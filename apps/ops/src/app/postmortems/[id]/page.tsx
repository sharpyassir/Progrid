'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, patch } from '@/lib/api';
import type { Postmortem, PostmortemSection } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { useShell } from '@/components/ctx';
import { Markdown } from '@/components/markdown';
import { Badge, Card, Countdown, ErrorNote, Loading, PageTitle, StatusBadge, TicketLink, Time, useAction } from '@/components/ui';

const SECTIONS: PostmortemSection[] = ['timeline', 'impact', 'rootCause', 'fix', 'prevention'];

/** The postmortem template: timeline, impact, root cause, fix and prevention. */
export default function PostmortemPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useShell();
  const pm = useLoad(() => api<Postmortem>(`/ops/v1/postmortems/${id}`), [id]);
  const [draft, setDraft] = useState<Record<PostmortemSection, string>>({ timeline: '', impact: '', rootCause: '', fix: '', prevention: '' });
  const { busy, run } = useAction();

  useEffect(() => {
    if (pm.data) setDraft({ timeline: pm.data.timeline ?? '', impact: pm.data.impact ?? '', rootCause: pm.data.rootCause ?? '', fix: pm.data.fix ?? '', prevention: pm.data.prevention ?? '' });
  }, [pm.data]);

  if (pm.error && !pm.data) return <ErrorNote error={pm.error} />;
  if (!pm.data) return <Loading />;
  const p = pm.data;
  const editable = p.status === 'DRAFT';
  const missing = SECTIONS.filter((s) => !draft[s].trim());

  const save = (submit: boolean) =>
    run(submit ? 'submit' : 'save', () => patch<Postmortem>(`/ops/v1/postmortems/${p.id}`, { ...draft, ...(submit ? { submit: true } : {}) }), submit ? t('postmortemSubmitted') : t('draftSaved')).then((r) => r && pm.setData(r));

  return (
    <div className="max-w-4xl space-y-4">
      <Link href="/postmortems" className="text-sm text-neutral-500 hover:underline"><span className="inline-block rtl:rotate-180">←</span> {t('navPostmortems')}</Link>
      <PageTitle title={t('postmortemFor', { n: p.ticket.number })} sub={p.ticket.subject}>
        <StatusBadge status={p.status} />
        {p.overdue && <Badge color="red">{t('overdue')}</Badge>}
      </PageTitle>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-600 dark:text-neutral-300">
        <span>{t('ticket')} <TicketLink ticket={p.ticket} /> <StatusBadge status={p.ticket.status} /></span>
        <span>{t('resolved')}: <Time value={p.ticket.resolvedAt} contractId={p.contractId} /></span>
        <span>{t('due')}: <Time value={p.dueAt} contractId={p.contractId} /> {editable && <Countdown to={p.dueAt} seconds={false} />}</span>
        {p.submittedAt && <span>{t('submitted')}: <Time value={p.submittedAt} contractId={p.contractId} /></span>}
      </div>
      {p.closeComment && <p className="rounded-md bg-neutral-50 p-3 text-sm dark:bg-neutral-800/50">{t('leadComment')}: {p.closeComment}</p>}

      {SECTIONS.map((s) => (
        <Card key={s} title={t(`pm_${s}`)}>
          {editable ? (
            <>
              <p className="mb-2 text-xs text-neutral-500">{t(`pmHint_${s}`)}</p>
              <textarea className="input min-h-32 font-mono text-xs" dir="auto" maxLength={50000} value={draft[s]} onChange={(e) => setDraft((d) => ({ ...d, [s]: e.target.value }))} />
            </>
          ) : <Markdown source={draft[s] || '-'} />}
        </Card>
      ))}

      {editable && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-neutral-200 bg-white/95 py-3 dark:border-neutral-800 dark:bg-neutral-950/95">
          <button className="btn-ghost" disabled={!!busy} onClick={() => save(false)}>{t('saveDraft')}</button>
          <button className="btn-primary" disabled={!!busy || missing.length > 0} onClick={() => save(true)}>{t('submitPostmortem')}</button>
          <span className="text-xs text-neutral-500">{missing.length ? t('pmMissing', { list: missing.map((m) => t(`pm_${m}`)).join(t('listSep')) }) : t('pmSubmitNote')}</span>
        </div>
      )}
    </div>
  );
}
