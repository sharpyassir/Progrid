'use client';

import { useEffect, useState } from 'react';
import { api, getToken } from '@/lib/api';
import { useUrls } from '@/lib/urls';
import { ErrorBox, PageHeader, TabBar, useLoad } from '@/components/connect/ui';
import { ApplyForm } from '@/components/affiliates/apply';
import { AssetsTab, DashboardTab, PayoutsTab, ReferralsTab } from '@/components/affiliates/dashboard';
import { date, useA, type Me, type Program } from '@/components/affiliates/common';

type Tab = 'dashboard' | 'referrals' | 'payouts' | 'assets';

/**
 * The affiliate portal (docs/affiliates.md). Signed out: the application with account creation.
 * Signed in: the application, its status, or for approved affiliates the dashboard, referrals,
 * payouts and marketing assets.
 */
export default function AffiliatePortalPage() {
  const { a, locale } = useA();
  const { www } = useUrls();
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => setSignedIn(!!getToken()), []);

  const header = (
    <PageHeader title={a('title')} subtitle={a('subtitle')} actions={<a href={`${www}${prefix}/affiliates`} target="_blank" rel="noreferrer" className="btn-ghost text-sm">{a('learnMore')}</a>} />
  );
  if (signedIn === null) return null;
  return (
    <div className="mx-auto max-w-5xl">
      {header}
      {signedIn ? <SignedIn /> : <SignedOut onApplied={() => setSignedIn(true)} />}
    </div>
  );
}

function SignedOut({ onApplied }: { onApplied: () => void }) {
  const { a } = useA();
  const { data, error } = useLoad(() => api<Program>('/v1/affiliates/program'), []);
  if (!data) return <><ErrorBox error={error} /><p className="text-sm text-neutral-500">{a('loading')}</p></>;
  // The new session is stored by the form; the signed in view takes over (and the console menus appear on the next navigation).
  return <ApplyForm program={data} signedIn={false} onDone={() => { onApplied(); window.location.reload(); }} />;
}

function SignedIn() {
  const { a, locale } = useA();
  const { data, error, reload } = useLoad(() => api<Me>('/v1/affiliates/me'), []);
  const [tab, setTab] = useState<Tab>('dashboard');
  if (!data) return <><ErrorBox error={error} /><p className="text-sm text-neutral-500">{a('loading')}</p></>;
  const af = data.affiliate;
  const canApply = !af || (af.status === 'rejected' && (!data.canReapplyAt || new Date(data.canReapplyAt) <= new Date()));

  if (canApply) {
    return (
      <div className="space-y-4">
        {af?.status === 'rejected' && <StatusCard title={a('rejectedH')} reason={af.statusReason}><p>{a('reapplyNow')}</p></StatusCard>}
        <ApplyForm program={data.program} signedIn defaultName={af?.name ?? data.user.name} onDone={() => reload()} />
      </div>
    );
  }
  if (af!.status === 'pending') return <StatusCard title={a('pendingH')}><p>{a('pendingBody')} <span dir="ltr">{af!.email}</span>.</p><p className="text-xs text-neutral-500">{a('appliedOn')}: {date(af!.appliedAt, locale)}</p></StatusCard>;
  if (af!.status === 'rejected') return <StatusCard title={a('rejectedH')} reason={af!.statusReason}><p>{a('reapplyOn')} {date(data.canReapplyAt, locale)}.</p></StatusCard>;
  if (af!.status === 'suspended') return <StatusCard title={a('suspendedH')} reason={af!.statusReason}><p>{a('suspendedBody')}</p></StatusCard>;

  return (
    <>
      <TabBar<Tab> label={a('title')} value={tab} onChange={setTab} tabs={[
        { id: 'dashboard', label: a('tabDashboard') }, { id: 'referrals', label: a('tabReferrals') }, { id: 'payouts', label: a('tabPayouts') }, { id: 'assets', label: a('tabAssets') },
      ]} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'dashboard' && <DashboardTab affiliate={af!} program={data.program} />}
        {tab === 'referrals' && <ReferralsTab />}
        {tab === 'payouts' && <PayoutsTab onDetailsSaved={reload} />}
        {tab === 'assets' && <AssetsTab code={af!.code ?? ''} program={data.program} />}
      </div>
    </>
  );
}

function StatusCard({ title, reason, children }: { title: string; reason?: string | null; children: React.ReactNode }) {
  const { a } = useA();
  return (
    <section className="card max-w-2xl space-y-2 text-sm">
      <h2 className="text-base font-medium">{title}</h2>
      {reason && <p><span className="text-neutral-500">{a('reason')}:</span> {reason}</p>}
      {children}
    </section>
  );
}
