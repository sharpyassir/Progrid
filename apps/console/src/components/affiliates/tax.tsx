'use client';

import { FormEvent, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { countryOptions } from '@/lib/countries';
import { ErrorBox, Notice, useAction, useLoad } from '@/components/connect/ui';
import { date, useA } from './common';
import type { AStringKey } from '@/lib/i18n-affiliates';

type FormType = 'W9' | 'W8BEN' | 'W8BENE';
interface TaxForm {
  id: string; formType: FormType; revision: string; legalName: string; businessName: string | null; tinType: string; tinMasked: string | null;
  backupWithholding: boolean; signedAt: string; expiresAt: string | null; country: string; status: string; statusReason: string | null;
}
export interface TaxInfo {
  state: 'missing' | 'active' | 'expired' | 'invalid'; form: TaxForm | null;
  certifications: { W9: string; W9Backup: string; W8BEN: string; W8BENE: string; servicesOutsideUs: string; revisions: Record<FormType, string> };
}

const W9_CLASSES = ['individual', 'c_corporation', 's_corporation', 'partnership', 'trust_estate', 'llc_c', 'llc_s', 'llc_p', 'other'];
const CH3 = ['corporation', 'partnership', 'disregarded_entity', 'simple_trust', 'grantor_trust', 'complex_trust', 'estate', 'other'];
const CH4 = ['active_nffe', 'passive_nffe', 'excepted_nffe', 'other'];

/**
 * US tax information for USD payouts (docs/affiliates-tax.md): the current form, and an electronic
 * Form W-9, W-8BEN or W-8BEN-E with the IRS certification text shown before signing.
 */
export function TaxCard({ onChange }: { onChange?: () => void }) {
  const { a } = useA();
  const { data, error, reload } = useLoad(() => api<TaxInfo>('/v1/affiliates/me/tax-form'), []);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  if (!data) return <ErrorBox error={error} />;
  const f = data.form;
  const tone = data.state === 'active' ? 'green' : 'amber';
  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-medium">{a('taxH')}</h2>
        <p className="mt-1 text-sm text-neutral-500">{a('taxLead')}</p>
      </div>
      {saved && <Notice>{a('taxSaved')}</Notice>}
      {data.state === 'missing' && !editing && <Notice tone="amber">{a('taxMissing')}</Notice>}
      {data.state === 'expired' && !editing && <Notice tone="amber">{a('taxExpired')}</Notice>}
      {data.state === 'invalid' && !editing && <Notice tone="amber">{a('taxInvalid')}{f?.statusReason ? ` (${f.statusReason})` : ''}</Notice>}
      {f && data.state === 'active' && !editing && (
        <div className="space-y-1 text-sm">
          <div><span className={`badge me-2 ${tone === 'green' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : ''}`}>{a('taxOnFile')}</span>{f.revision} · {f.legalName}{f.businessName ? ` (${f.businessName})` : ''} · <span dir="ltr">{f.tinMasked ?? '—'}</span></div>
          <div className="text-xs text-neutral-500">{a('taxSigned')}: {date(f.signedAt, 'en')}{f.expiresAt && <> · {a('taxValidUntil')}: {date(f.expiresAt, 'en')}</>}</div>
          {f.backupWithholding && <p className="text-xs text-amber-700 dark:text-amber-400">{a('taxBackup')}</p>}
        </div>
      )}
      {editing
        ? <TaxFormEditor info={data} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); setSaved(true); reload(); onChange?.(); }} />
        : <button type="button" className={data.state === 'active' ? 'btn-ghost text-sm' : 'btn-primary text-sm'} onClick={() => { setSaved(false); setEditing(true); }}>{data.state === 'active' ? a('taxNew') : a('taxAdd')}</button>}
    </section>
  );
}

function TaxFormEditor({ info, onCancel, onSaved }: { info: TaxInfo; onCancel: () => void; onSaved: () => void }) {
  const { a, locale } = useA();
  const [type, setType] = useState<FormType | null>(null);
  const [backup, setBackup] = useState(false);
  const [noFtin, setNoFtin] = useState(false);
  const { busy, error, run } = useAction();
  const countries = useMemo(() => countryOptions(locale), [locale]);
  const foreign = countries.filter((c) => c.code !== 'US');
  const cert = type === 'W9' ? (backup ? info.certifications.W9Backup : info.certifications.W9) : type === 'W8BEN' ? info.certifications.W8BEN : type === 'W8BENE' ? info.certifications.W8BENE : '';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => { const x = String(f.get(k) ?? '').trim(); return x || undefined; };
    const body = {
      formType: type,
      legalName: v('legalName'), businessName: v('businessName'), taxClassification: v('taxClassification'), fatcaStatus: v('fatcaStatus'),
      tinType: type === 'W9' ? v('tinType') : 'foreign', tin: v('tin'), foreignTinNotRequired: type !== 'W9' ? noFtin : undefined,
      citizenshipCountry: v('citizenshipCountry'), dateOfBirth: v('dateOfBirth'),
      addressLine1: v('addressLine1'), addressLine2: v('addressLine2'), city: v('city'), region: type === 'W9' ? v('region')?.toUpperCase() : v('region'), postalCode: v('postalCode'),
      country: type === 'W9' ? 'US' : v('country'),
      subjectToBackupWithholding: type === 'W9' ? backup : undefined, servicesOutsideUs: type !== 'W9' ? f.get('servicesOutsideUs') === 'on' : undefined,
      signatureName: v('signatureName'), certify: f.get('certify') === 'on',
    };
    const r = await run(() => api('/v1/affiliates/me/tax-form', { method: 'POST', body: JSON.stringify(body) }));
    if (r) onSaved();
  }

  const field = (name: string, label: AStringKey, opts: { required?: boolean; type?: string; ltr?: boolean; max?: number; placeholder?: string } = {}) => (
    <label className="block space-y-1 text-sm"><span>{a(label)}</span><input className="input" name={name} type={opts.type ?? 'text'} required={opts.required} maxLength={opts.max ?? 120} dir={opts.ltr ? 'ltr' : undefined} placeholder={opts.placeholder} autoComplete="off" /></label>
  );
  const select = (name: string, label: AStringKey, options: string[], prefix: string) => (
    <label className="block space-y-1 text-sm"><span>{a(label)}</span>
      <select className="input" name={name} required defaultValue=""><option value="" disabled>{a('choose')}</option>{options.map((o) => <option key={o} value={o}>{a(`${prefix}${o}` as AStringKey)}</option>)}</select>
    </label>
  );
  const countrySelect = (name: string, label: AStringKey, list = foreign) => (
    <label className="block space-y-1 text-sm"><span>{a(label)}</span>
      <select className="input" name={name} required defaultValue=""><option value="" disabled>{a('choose')}</option>{list.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
    </label>
  );

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{a('taxWho')}</legend>
        {(['W9', 'W8BEN', 'W8BENE'] as FormType[]).map((t) => (
          <label key={t} className="flex items-center gap-2 text-sm"><input type="radio" name="formType" checked={type === t} onChange={() => setType(t)} />{a(t === 'W9' ? 'taxOptW9' : t === 'W8BEN' ? 'taxOptW8' : 'taxOptW8E')}</label>
        ))}
      </fieldset>
      {type && (
        <form key={type} onSubmit={submit} className="space-y-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <p className="text-xs text-neutral-500">{info.certifications.revisions[type]}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {field('legalName', type === 'W8BENE' ? 'taxEntityName' : 'taxName', { required: true })}
            {type === 'W9' && field('businessName', 'taxBusinessName')}
            {type === 'W9' && select('taxClassification', 'taxClass', W9_CLASSES, 'cls_')}
            {type === 'W8BENE' && select('taxClassification', 'taxCh3', CH3, 'ch3_')}
            {type === 'W8BENE' && select('fatcaStatus', 'taxCh4', CH4, 'ch4_')}
            {type === 'W8BEN' && countrySelect('citizenshipCountry', 'taxCitizenship')}
            {type === 'W8BENE' && countrySelect('citizenshipCountry', 'taxIncorporation')}
            {type === 'W8BEN' && field('dateOfBirth', 'taxDob', { required: true, type: 'date', ltr: true })}
          </div>
          {type === 'W9' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1 text-sm"><span>{a('taxTinType')}</span>
                <select className="input" name="tinType" required defaultValue="ssn">{['ssn', 'itin', 'ein'].map((o) => <option key={o} value={o}>{a(`tin_${o}` as AStringKey)}</option>)}</select>
              </label>
              {field('tin', 'taxTin', { required: true, ltr: true, max: 11, placeholder: '123-45-6789' })}
            </div>
          ) : (
            <div className="space-y-2">
              {!noFtin && field('tin', 'taxForeignTin', { required: true, ltr: true, max: 40 })}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={noFtin} onChange={(e) => setNoFtin(e.target.checked)} />{a('taxNoForeignTin')}</label>
            </div>
          )}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">{a(type === 'W9' ? 'taxUsAddress' : 'taxPermAddress')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {field('addressLine1', 'taxStreet', { required: true })}
              {field('addressLine2', 'taxStreet2')}
              {field('city', 'taxCity', { required: true, max: 80 })}
              {type === 'W9' ? field('region', 'taxState', { required: true, max: 2, ltr: true, placeholder: 'TX' }) : field('region', 'taxRegion', { max: 80 })}
              {type === 'W9' ? field('postalCode', 'taxZip', { required: true, max: 10, ltr: true }) : field('postalCode', 'taxPostal', { max: 20, ltr: true })}
              {type !== 'W9' && countrySelect('country', 'taxCountry')}
            </div>
          </fieldset>
          {type === 'W9'
            ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={backup} onChange={(e) => setBackup(e.target.checked)} />{a('taxBackupQ')}</label>
            : <div className="space-y-1"><label className="flex items-start gap-2 text-sm"><input type="checkbox" name="servicesOutsideUs" className="mt-1" required />{a('taxOutsideUs')}</label><p className="text-xs text-neutral-500">{a('taxOutsideUsNote')}</p></div>}
          <div className="space-y-1">
            <div className="text-sm font-medium">{a('taxCertH')}</div>
            <p className="text-xs text-neutral-500">{a('taxCertNote')}</p>
            <pre dir="ltr" className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-start text-xs leading-relaxed dark:bg-neutral-900">{cert}{type !== 'W9' ? `\n\n${info.certifications.servicesOutsideUs}` : ''}</pre>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">{field('signatureName', 'taxSignature', { required: true })}</div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="certify" required className="mt-1" />{a('taxCertify')}</label>
          <ErrorBox error={error} />
          <div className="flex gap-2">
            <button className="btn-primary text-sm" disabled={busy}>{a('taxSubmit')}</button>
            <button type="button" className="btn-ghost text-sm" onClick={onCancel}>×</button>
          </div>
        </form>
      )}
    </div>
  );
}
