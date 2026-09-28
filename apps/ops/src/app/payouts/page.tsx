'use client';

import { API_URL, api } from '@/lib/api';
import type { Payout } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { fmtMinutes } from '@/lib/time';
import { money } from '@/lib/money';
import { useShell } from '@/components/ctx';
import { Card, Empty, ErrorNote, Loading, PageTitle, StatusBadge, Time, useUnits } from '@/components/ui';

/** Monthly statements, read only. The PDF downloads with the session cookie. */
export default function PayoutsPage() {
  const { t, locale } = useShell();
  const units = useUnits();
  const list = useLoad(() => api<{ data: Payout[] }>('/ops/v1/payouts'), []);

  return (
    <div className="max-w-5xl">
      <PageTitle title={t('navPayouts')} sub={t('payoutsLead')} />
      <ErrorNote error={list.error} />
      {!list.data ? <Loading /> : !list.data.data.length ? <Card><Empty>{t('noPayouts')}</Empty></Card> : (
        <div className="space-y-4">
          {list.data.data.map((p) => (
            <Card
              key={p.id}
              title={<span dir="ltr">{p.period}</span>}
              actions={
                <>
                  <StatusBadge status={p.status} />
                  {p.hasStatement && <a className="btn-ghost" href={`${API_URL}/ops/v1/payouts/${p.id}/statement`} target="_blank" rel="noopener">{t('downloadPdf')}</a>}
                </>
              }
            >
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
                <div><dt className="text-xs text-neutral-500">{t('total')}</dt><dd className="text-lg font-semibold tabular-nums">{money(p.totalMinor, p.currency, locale)}</dd></div>
                <div><dt className="text-xs text-neutral-500">{t('workedTime')}</dt><dd className="tabular-nums">{fmtMinutes(p.workedMinutes, units)}</dd><dd className="text-xs text-neutral-500">{t('nightTime')}: <span>{fmtMinutes(p.nightMinutes, units)}</span> (x{p.nightMultiplier})</dd></div>
                <div><dt className="text-xs text-neutral-500">{t('workAmount')}</dt><dd className="tabular-nums">{money(p.workMinor, p.currency, locale)}</dd><dd className="text-xs text-neutral-500">{t('rate')}: {money(p.hourlyRateMinor, p.currency, locale)} / {t('hour')}</dd></div>
                <div><dt className="text-xs text-neutral-500">{t('standby')}</dt><dd className="tabular-nums">{money(p.standbyMinor, p.currency, locale)}</dd><dd className="text-xs text-neutral-500">{t('shiftsN', { n: p.standbyShifts })} x {money(p.standbyFeeMinor, p.currency, locale)}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-neutral-500">
                {p.issuedAt && <>{t('issued')} <Time value={p.issuedAt} mode="date" /></>}
                {p.paidAt && <> · {t('paid')} <Time value={p.paidAt} mode="date" />{p.paidReference ? ` · ${t('reference')}: ${p.paidReference}` : ''}</>}
              </p>
              {!!p.lines?.workLogs?.length && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-blue-600">{t('lines', { n: p.lines.workLogs.length })}</summary>
                  <div className="-mx-2 mt-2 overflow-x-auto">
                    <table className="table">
                      <thead><tr><th>{t('started')}</th><th>{t('customerCol')}</th><th>{t('ticket')}</th><th>{t('minutes')}</th><th>{t('nightTime')}</th><th>{t('amount')}</th></tr></thead>
                      <tbody>
                        {p.lines.workLogs.map((l, i) => (
                          <tr key={i}>
                            <td><Time value={l.startedAt} /></td>
                            <td>{l.customer}</td>
                            <td className="font-mono" dir="ltr">{l.ticketNumber ? `#${l.ticketNumber}` : '-'}</td>
                            <td className="tabular-nums">{l.minutes}</td>
                            <td className="tabular-nums">{l.nightMinutes}</td>
                            <td className="tabular-nums">{money(l.amountMinor, p.currency, locale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
