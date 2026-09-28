'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { AdminShell } from '@/components/admin-shell';
import { useShell } from '@/components/shell';
import { Cell, ErrorBox, Field, Loading, OkBox, Row, Table, tk, ToneBadge, useAccount } from '@/components/managed';
import { errText, fmtDateTime, isLeadRoles, type Shift, type StaffMember } from '@/lib/managed';

interface Current { primary: StaffMember | null; secondary: StaffMember | null; shifts: Shift[] }
interface PageRow { id: string; alertId: string | null; ticketId: string | null; channel: string; urgency: string; message: string; error: string | null; sentAt: string | null; ackAt: string | null }

const DAY = 86_400_000;
const CHANNELS = ['SMS', 'WHATSAPP', 'PUSH', 'EMAIL'] as const;
/** ISO time as the value of a datetime-local input, in the viewer's zone. */
const toLocalInput = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** On call: who is on now, the next 14 days, shift editing for leads and your own paging contact. */
export default function AdminOnCall() {
  const { locale } = useShell();
  const { account } = useAccount();
  const [current, setCurrent] = useState<Current | null>(null);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [editing, setEditing] = useState<Shift | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lead = account ? isLeadRoles(account.staffRoles) : false;

  const load = useCallback(async () => {
    const from = new Date();
    const to = new Date(from.getTime() + 14 * DAY);
    const [c, s, st, p] = await Promise.all([
      api<Current>('/admin/managed/oncall/current'),
      api<{ data: Shift[] }>(`/admin/managed/oncall/shifts?from=${from.toISOString()}&to=${to.toISOString()}`),
      api<{ data: StaffMember[] }>('/admin/managed/staff'),
      api<{ data: PageRow[] }>('/admin/managed/pages?mine=true&open=true').catch(() => ({ data: [] as PageRow[] })),
    ]);
    setCurrent(c); setShifts(s.data); setStaff(st.data); setPages(p.data);
  }, []);
  useEffect(() => { load().catch((e) => setError(errText(e))); }, [load]);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true); setError(null); setOk(null);
    try { await fn(); if (done) setOk(done); await load(); return true; } catch (e) { setError(errText(e)); return false; } finally { setBusy(false); }
  }

  async function saveShift(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { userId: f.get('userId'), role: f.get('role'), startsAt: new Date(String(f.get('startsAt'))).toISOString(), endsAt: new Date(String(f.get('endsAt'))).toISOString(), note: String(f.get('note') ?? '') || undefined };
    const isNew = editing === 'new';
    const path = isNew ? '/admin/managed/oncall/shifts' : `/admin/managed/oncall/shifts/${(editing as Shift).id}`;
    if (await run(() => api(path, { method: isNew ? 'POST' : 'PATCH', body: JSON.stringify(body) }), t(locale, 'admMcShiftSaved'))) setEditing(null);
  }
  async function saveContact(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!account) return;
    const f = new FormData(e.currentTarget);
    const phone = String(f.get('phone') ?? '').replace(/\s+/g, '');
    await run(() => api(`/admin/managed/staff/${account.user.id}/contact`, { method: 'PUT', body: JSON.stringify({ phone: phone || null, pagingChannel: f.get('channel') || null }) }), t(locale, 'admMcContactSaved'));
  }

  if (!current || !shifts) return <AdminShell title={t(locale, 'admMcOnCallTitle')}>{error ? <ErrorBox error={error} /> : <Loading />}</AdminShell>;

  const people = new Set(shifts.filter((s) => new Date(s.endsAt).getTime() > Date.now()).map((s) => s.userId));
  const today = startOfDay(new Date());
  const days = Array.from({ length: 14 }, (_, i) => new Date(today.getTime() + i * DAY));
  const me = staff.find((s) => s.id === account?.user.id);
  const draft = editing && editing !== 'new' ? editing : null;
  const defaultStart = new Date(today.getTime() + DAY + 9 * 3_600_000).toISOString();
  const defaultEnd = new Date(today.getTime() + 8 * DAY + 9 * 3_600_000).toISOString();

  return (
    <AdminShell title={t(locale, 'admMcOnCallTitle')} actions={lead ? <button className="btn-primary" onClick={() => setEditing('new')}>{t(locale, 'admMcAddShift')}</button> : undefined}>
      <ErrorBox error={error} />
      <OkBox msg={ok} />
      {people.size < 2 && <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{tf(locale, 'admMcCoverageWarning')(people.size)}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        {([['admMcPrimary', current.primary], ['admMcSecondary', current.secondary]] as const).map(([label, p]) => (
          <div key={label} className={`card ${!p ? 'border-red-300 dark:border-red-900' : ''}`}>
            <div className="text-xs text-neutral-500">{t(locale, label)}</div>
            {p ? <><div className="text-lg font-semibold">{p.name}</div><div className="text-xs text-neutral-500">{p.email}{p.phone ? <> · <span dir="ltr">{p.phone}</span></> : ''}{p.pagingChannel ? ` · ${tk(locale, `admMcChannel_${p.pagingChannel}`, p.pagingChannel)}` : ''}</div></> : <div className="text-lg font-semibold text-red-700 dark:text-red-400">{t(locale, 'admMcNobody')}</div>}
          </div>
        ))}
      </div>

      {pages.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">{t(locale, 'admMcPagesToYou')}</h2>
          {pages.map((p) => (
            <div key={p.id} className="card flex flex-wrap items-center gap-2 border-red-300 text-sm dark:border-red-900">
              <ToneBadge tone="red">{tk(locale, `admMcChannel_${p.channel}`, p.channel)}</ToneBadge>
              <span className="min-w-0 flex-1 break-words">{p.message}</span>
              <span className="text-xs text-neutral-500">{fmtDateTime(p.sentAt, locale)}</span>
              {p.ticketId && <Link href={`/admin/managed/tickets/${p.ticketId}`} className="btn-ghost">{t(locale, 'admMcOpenTicket')}</Link>}
              <button className="btn-primary" disabled={busy} onClick={() => run(() => api(`/admin/managed/pages/${p.id}/ack`, { method: 'POST' }), t(locale, 'admMcPageAcked'))}>{t(locale, 'admMcAck')}</button>
            </div>
          ))}
        </section>
      )}

      {editing && lead && (
        <form key={draft?.id ?? 'new'} onSubmit={saveShift} className="card space-y-3">
          <h2 className="font-medium">{draft ? t(locale, 'admMcEditShift') : t(locale, 'admMcAddShift')}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t(locale, 'admMcPerson')}><select className="input" name="userId" required defaultValue={draft?.userId ?? ''}><option value="" disabled>{t(locale, 'admMcChoosePerson')}</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label={t(locale, 'role')}><select className="input" name="role" defaultValue={draft?.role ?? 'PRIMARY'}><option value="PRIMARY">{t(locale, 'admMcPrimary')}</option><option value="SECONDARY">{t(locale, 'admMcSecondary')}</option></select></Field>
            <Field label={t(locale, 'admMcStarts')}><input className="input" type="datetime-local" name="startsAt" required dir="ltr" defaultValue={toLocalInput(draft?.startsAt ?? defaultStart)} /></Field>
            <Field label={t(locale, 'admMcEnds')}><input className="input" type="datetime-local" name="endsAt" required dir="ltr" defaultValue={toLocalInput(draft?.endsAt ?? defaultEnd)} /></Field>
          </div>
          <Field label={t(locale, 'notes')}><input className="input" name="note" maxLength={500} defaultValue={draft?.note ?? ''} /></Field>
          <p className="text-xs text-neutral-500">{t(locale, 'admMcTimesLocal')}</p>
          <div className="flex gap-2"><button className="btn-primary" disabled={busy}>{t(locale, 'save')}</button><button type="button" className="btn-ghost" onClick={() => setEditing(null)}>{t(locale, 'cancel')}</button></div>
        </form>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">{t(locale, 'admMcNext14Days')}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {days.map((d) => {
            const end = d.getTime() + DAY;
            const on = shifts.filter((s) => new Date(s.startsAt).getTime() < end && new Date(s.endsAt).getTime() > d.getTime());
            const primary = on.filter((s) => s.role === 'PRIMARY');
            const secondary = on.filter((s) => s.role === 'SECONDARY');
            return (
              <div key={d.toISOString()} className={`card space-y-1 p-2 text-xs ${primary.length === 0 ? 'border-amber-300 dark:border-amber-800' : ''}`}>
                <div className="font-medium">{d.toLocaleDateString(locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : locale, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                <div><span className="text-neutral-500">{t(locale, 'admMcPrimaryShort')}: </span>{primary.map((s) => s.user?.name ?? s.userId).join(', ') || <span className="text-amber-700 dark:text-amber-400">{t(locale, 'admMcGap')}</span>}</div>
                <div><span className="text-neutral-500">{t(locale, 'admMcSecondaryShort')}: </span>{secondary.map((s) => s.user?.name ?? s.userId).join(', ') || '—'}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">{t(locale, 'admMcShifts')}</h2>
        <Table head={[t(locale, 'admMcPerson'), t(locale, 'role'), t(locale, 'admMcStarts'), t(locale, 'admMcEnds'), t(locale, 'notes'), '']} empty={shifts.length === 0 ? t(locale, 'admMcNoShifts') : undefined}>
          {shifts.map((s) => (
            <Row key={s.id}>
              <Cell className="font-medium">{s.user?.name ?? s.userId}</Cell>
              <Cell>{s.role === 'PRIMARY' ? <ToneBadge tone="blue">{t(locale, 'admMcPrimary')}</ToneBadge> : <ToneBadge tone="grey">{t(locale, 'admMcSecondary')}</ToneBadge>}</Cell>
              <Cell className="text-xs">{fmtDateTime(s.startsAt, locale)}</Cell>
              <Cell className="text-xs">{fmtDateTime(s.endsAt, locale)}</Cell>
              <Cell className="text-xs text-neutral-500">{s.note}</Cell>
              <Cell className="whitespace-nowrap text-end">{lead && <>
                <button className="btn-ghost me-1" onClick={() => setEditing(s)}>{t(locale, 'admMcEdit')}</button>
                <button className="btn-danger" disabled={busy} onClick={() => { if (confirm(t(locale, 'admMcDeleteShiftConfirm'))) run(() => api(`/admin/managed/oncall/shifts/${s.id}`, { method: 'DELETE' })); }}>{t(locale, 'delete')}</button>
              </>}</Cell>
            </Row>
          ))}
        </Table>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <form onSubmit={saveContact} className="card space-y-3" key={me?.id ?? 'me'}>
          <h2 className="font-medium">{t(locale, 'admMcMyContact')}</h2>
          <p className="text-xs text-neutral-500">{t(locale, 'admMcMyContactNote')}</p>
          <Field label={t(locale, 'admMcPhone')} hint={t(locale, 'admMcPhoneHint')}><input className="input" name="phone" dir="ltr" placeholder="+966500000000" pattern="\+[1-9][0-9 ]{6,18}" defaultValue={me?.phone ?? ''} /></Field>
          <Field label={t(locale, 'admMcChannel')}>
            <select className="input" name="channel" defaultValue={me?.pagingChannel ?? ''}>
              <option value="">{t(locale, 'admMcChannelDefault')}</option>
              {CHANNELS.map((c) => <option key={c} value={c}>{tk(locale, `admMcChannel_${c}`)}</option>)}
            </select>
          </Field>
          <button className="btn-primary" disabled={busy || !account}>{t(locale, 'save')}</button>
        </form>
        <div className="space-y-2">
          <h2 className="font-medium">{t(locale, 'admMcTeamContacts')}</h2>
          <Table head={[t(locale, 'name'), t(locale, 'admMcPhone'), t(locale, 'admMcChannel'), t(locale, 'role')]} empty={staff.length === 0 ? t(locale, 'nothingYet') : undefined}>
            {staff.map((s) => (
              <Row key={s.id}>
                <Cell className="font-medium">{s.name}<div className="text-xs text-neutral-500">{s.email}</div></Cell>
                <Cell className="text-xs" dir="ltr">{s.phone ?? <span className="text-amber-700 dark:text-amber-400">{t(locale, 'admMcNoPhone')}</span>}</Cell>
                <Cell className="text-xs">{s.pagingChannel ? tk(locale, `admMcChannel_${s.pagingChannel}`, s.pagingChannel) : '—'}</Cell>
                <Cell className="text-xs text-neutral-500">{s.staffRoles.length ? s.staffRoles.map((r) => tk(locale, `admMcRole_${r}`, r)).join(', ') : t(locale, 'admMcFullStaff')}</Cell>
              </Row>
            ))}
          </Table>
        </div>
      </section>
    </AdminShell>
  );
}
