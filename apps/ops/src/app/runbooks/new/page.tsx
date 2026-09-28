'use client';

import { useRouter } from 'next/navigation';
import { post } from '@/lib/api';
import type { Runbook } from '@/lib/types';
import { useShell } from '@/components/ctx';
import { RunbookEditor } from '@/components/runbook-editor';
import { PageTitle, useAction } from '@/components/ui';

export default function NewRunbookPage() {
  const { t } = useShell();
  const router = useRouter();
  const { busy, run } = useAction();
  return (
    <div className="max-w-4xl">
      <PageTitle title={t('newRunbook')} />
      <RunbookEditor
        busy={busy === 'save'}
        onCancel={() => router.push('/runbooks')}
        onSave={(d) => run('save', () => post<Runbook>('/ops/v1/runbooks', d), t('runbookSaved')).then((r) => r && router.push(`/runbooks/${r.slug}`))}
      />
    </div>
  );
}
