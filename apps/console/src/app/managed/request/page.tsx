'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { useShell } from '@/components/shell';
import { Empty, ErrorBox, Field, Loading, ManagedFrame, useAccount } from '@/components/managed';
import { CoverageLabel, PlanPrice, TargetList } from '@/components/managed-plans';
import { errText, hours, type Plan } from '@/lib/managed';

/** Request a managed cloud plan. Team owners only; the request waits for a support lead. */
export default function RequestPage() {
  return <Suspense><RequestForm /></Suspense>;
}

function RequestForm() {
  const { locale } = useShell();
  const router = useRouter();
  const params = useSearchParams();
  const { account, error: accountError } = useAccount();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [code, setCode] = useState(params.get('plan') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ data: Plan[] }>('/v1/managed/plans').then((r) => {
      setPlans(r.data);
      setCode((c) => (r.data.some((p) => p.code === c) ? c : r.data[0]?.code ?? ''));
    }).catch((e) => setError(errText(e)));
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      await api('/v1/managed/contracts', { method: 'POST', body: JSON.stringify({ plan: code, calendar: f.get('calendar'), notes: String(f.get('notes') ?? '').trim() || undefined }) });
      router.push('/managed?requested=1');
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const owner = account?.role === 'owner';
  const title = t(locale, 'mcRequestTitle');
  if (accountError) return <ManagedFrame title={title} owner={owner}><ErrorBox error={accountError} /></ManagedFrame>;
  if (!account || (!plans && !error)) return <ManagedFrame title={title} owner={owner}><Loading /></ManagedFrame>;
  if (!owner) return <ManagedFrame title={title} owner={owner}><Empty>{t(locale, 'mcOwnerOnly')}</Empty></ManagedFrame>;
  const plan = plans?.find((p) => p.code === code);

  return (
    <ManagedFrame title={title} owner={owner}>
      <ErrorBox error={error} />
      {plans && plans.length === 0 && <Empty>{t(locale, 'mcNoPlans')}</Empty>}
      {plans && plans.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <form onSubmit={submit} className="card space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm text-neutral-500">{t(locale, 'mcPlan')}</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {plans.map((p) => (
                  <label key={p.id} className={`cursor-pointer rounded-md border p-3 text-sm ${code === p.code ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20' : 'border-neutral-300 dark:border-neutral-700'}`}>
                    <input type="radio" name="plan" value={p.code} checked={code === p.code} onChange={() => setCode(p.code)} className="sr-only" />
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-neutral-500"><CoverageLabel coverage={p.coverage} /></div>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label={t(locale, 'mcCalendar')} hint={t(locale, 'mcCalendarHint')}>
              <input type="hidden" name="calendar" value="SA" />
              <div className="input bg-neutral-50 dark:bg-neutral-900">{t(locale, 'mcCalendar_SA')}</div>
            </Field>
            <Field label={t(locale, 'mcWhatToManage')} hint={t(locale, 'mcWhatToManageHint')}>
              <textarea className="input min-h-32" name="notes" maxLength={4000} />
            </Field>
            <p className="text-xs text-neutral-500">{t(locale, 'mcRequestNext')}</p>
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy || !code}>{busy ? t(locale, 'mcSending') : t(locale, 'mcSendRequest')}</button>
              <Link href="/managed" className="btn-ghost">{t(locale, 'cancel')}</Link>
            </div>
          </form>
          {plan && (
            <aside className="card space-y-3">
              <div className="text-lg font-medium">{plan.name}</div>
              <PlanPrice plan={plan} />
              <p className="text-sm text-neutral-600 dark:text-neutral-300">{plan.description}</p>
              <p className="text-sm">{plan.custom && !plan.includedEngineerMinutes ? t(locale, 'mcAgreedPerContract') : tf(locale, 'mcIncludedHoursLine')(hours(plan.includedEngineerMinutes))}</p>
              <TargetList targets={plan.responseTargets} coverage={plan.coverage} />
            </aside>
          )}
        </div>
      )}
    </ManagedFrame>
  );
}
