'use client';

import Link from 'next/link';
import { money, withVat, VAT_RATE } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { useShell } from '@/components/shell';
import { PriorityBadge, tk } from '@/components/managed';
import { fmtTarget, hours, PRIORITIES, type Plan } from '@/lib/managed';

/** Price in SAR excluding VAT with the VAT inclusive total below it; custom plans say so. */
export function PlanPrice({ plan, large = true }: { plan: Pick<Plan, 'priceMinor' | 'currency'>; large?: boolean }) {
  const { locale } = useShell();
  if (plan.priceMinor === null) return <div><div className={large ? 'text-2xl font-semibold' : 'font-medium'}>{t(locale, 'mcCustomPrice')}</div><div className="text-xs text-neutral-500">{t(locale, 'mcCustomPriceNote')}</div></div>;
  return (
    <div>
      <div className={large ? 'text-2xl font-semibold' : 'font-medium'}>{money(plan.priceMinor, plan.currency, locale)}<span className="text-sm font-normal text-neutral-500">{t(locale, 'perMonth')}</span></div>
      <div className="text-xs text-neutral-500">{tf(locale, 'mcExclVat')(money(withVat(plan.priceMinor), plan.currency, locale), Math.round(VAT_RATE * 100))}</div>
    </div>
  );
}

export function CoverageLabel({ coverage }: { coverage: Plan['coverage'] }) {
  const { locale } = useShell();
  return <>{tk(locale, `mcCoverage_${coverage}`, coverage)}</>;
}

/** Response targets per priority in words, one line each. */
export function TargetList({ targets, coverage }: { targets: Plan['responseTargets']; coverage: Plan['coverage'] }) {
  const { locale } = useShell();
  return (
    <ul className="space-y-1 text-sm">
      {PRIORITIES.map((p) => (
        <li key={p} className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><PriorityBadge p={p} /><span className="text-xs text-neutral-500">{tk(locale, `mcPrioShort_${p}`)}</span></span>
          <span>{targets?.[p] ? fmtTarget(targets[p], coverage, locale) : '—'}</span>
        </li>
      ))}
    </ul>
  );
}

/** One plan as a card: price, coverage, limits, included time and response targets. */
export function PlanCard({ plan, canRequest, highlight }: { plan: Plan; canRequest: boolean; highlight?: boolean }) {
  const { locale } = useShell();
  return (
    <div className={`card flex flex-col gap-3 ${highlight ? 'border-blue-500' : ''}`}>
      <div>
        <div className="flex items-baseline gap-2"><span className="text-lg font-medium">{plan.name}</span>{highlight && <span className="badge bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">{t(locale, 'mcPopular')}</span>}</div>
        {plan.description && <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{plan.description}</p>}
      </div>
      <PlanPrice plan={plan} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-neutral-500">{t(locale, 'mcCoverage')}</dt><dd className="text-end"><CoverageLabel coverage={plan.coverage} /></dd>
        <dt className="text-neutral-500">{t(locale, 'mcMaxAssets')}</dt><dd className="text-end">{plan.maxAssets ?? t(locale, 'mcCustom')}</dd>
        <dt className="text-neutral-500">{t(locale, 'mcIncludedTime')}</dt>
        <dd className="text-end">{plan.custom && !plan.includedEngineerMinutes ? t(locale, 'mcAgreedPerContract') : tf(locale, 'mcHoursPerMonth')(hours(plan.includedEngineerMinutes))}</dd>
        <dt className="text-neutral-500">{t(locale, 'mcExtraTime')}</dt><dd className="text-end">{tf(locale, 'mcPerHour')(money(plan.hourlyRateMinor, plan.currency, locale))}</dd>
      </dl>
      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">{t(locale, 'mcResponseTargets')}</div>
        <TargetList targets={plan.responseTargets} coverage={plan.coverage} />
      </div>
      <div className="mt-auto pt-1">
        {canRequest
          ? <Link href={`/managed/request?plan=${plan.code}`} className={`${highlight ? 'btn-primary' : 'btn-ghost'} w-full justify-center`}>{plan.custom ? t(locale, 'mcTalkToUs') : t(locale, 'mcRequestPlan')}</Link>
          : null}
      </div>
    </div>
  );
}
