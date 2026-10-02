'use client';

import { PageHeader, useC } from '@/components/connect/ui';
import { TemplateGrid } from '@/components/connect/templates';

export default function TemplatesPage() {
  const { c } = useC();
  return (
    <div>
      <PageHeader title={c('templatesTitle')} subtitle={c('templatesNote')} />
      <TemplateGrid />
    </div>
  );
}
