'use client';

import { useState } from 'react';
import { WWW_URL } from '@/lib/api';
import { capi, Docs } from '@/lib/connect';
import { CodeBlock, CopyField, Json, Segmented, useC, useLoad } from '../ui';
import type { AgentTabProps } from './types';

type Lang = 'curl' | 'javascript' | 'python' | 'php';
const LANGS: { id: Lang; label: string }[] = [{ id: 'curl', label: 'cURL' }, { id: 'javascript', label: 'JavaScript' }, { id: 'python', label: 'Python' }, { id: 'php', label: 'PHP' }];

/** Used when the docs endpoint is not reachable, so the tab still shows working examples. */
function fallbackExamples(ep: string): Docs['examples'] {
  const body = '{"input": {"message": "Hello"}}';
  return {
    curl: `curl -X POST ${ep} \\\n  -H "Authorization: Bearer $PRGD_AGENT_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`,
    javascript: `const res = await fetch("${ep}", {\n  method: "POST",\n  headers: {\n    Authorization: \`Bearer \${process.env.PRGD_AGENT_KEY}\`,\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({ input: { message: "Hello" } }),\n});\nconst run = await res.json();`,
    python: `import os, requests\n\nres = requests.post(\n    "${ep}",\n    headers={"Authorization": f"Bearer {os.environ['PRGD_AGENT_KEY']}"},\n    json={"input": {"message": "Hello"}},\n    timeout=70,\n)\nprint(res.json()["output"])`,
    php: `<?php\n$ch = curl_init("${ep}");\ncurl_setopt_array($ch, [\n  CURLOPT_POST => true,\n  CURLOPT_RETURNTRANSFER => true,\n  CURLOPT_HTTPHEADER => [\n    "Authorization: Bearer " . getenv("PRGD_AGENT_KEY"),\n    "Content-Type: application/json",\n  ],\n  CURLOPT_POSTFIELDS => json_encode(["input" => ["message" => "Hello"]]),\n]);\n$run = json_decode(curl_exec($ch), true);`,
  };
}

export function ApiTab({ agent }: AgentTabProps) {
  const { c } = useC();
  const [lang, setLang] = useState<Lang>('curl');
  const { data } = useLoad(() => capi<Docs>(`/agents/${agent.id}/docs`), [agent.id]);
  const examples = data?.examples ?? fallbackExamples(agent.runEndpoint);
  const errors: [string, string][] = [['401', c('e401')], ['402', c('e402')], ['404', c('e404')], ['409', c('e409')], ['429', c('e429')]];
  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span dir="ltr" className="badge bg-green-100 font-mono text-green-800 dark:bg-green-900/40 dark:text-green-300">POST</span>
          <div className="min-w-0 flex-1"><CopyField value={data?.endpoint ?? agent.runEndpoint} label={c('endpoint')} /></div>
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{c('authNote')}</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{c('syncNote')}</p>
      </section>
      <section className="card min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex-1 font-semibold">{c('exampleRequest')}</h2>
          <Segmented label={c('exampleRequest')} value={lang} onChange={setLang} options={LANGS} />
        </div>
        <CodeBlock code={examples[lang]} label={LANGS.find((l) => l.id === lang)?.label} />
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card min-w-0"><h2 className="mb-2 font-semibold">{c('requestSchema')}</h2><Json value={data?.requestSchema ?? { type: 'object', properties: { input: {}, async: { type: 'boolean' }, idempotencyKey: { type: 'string' } }, required: ['input'] }} /></section>
        <section className="card min-w-0"><h2 className="mb-2 font-semibold">{c('responseSchema')}</h2><Json value={data?.responseSchema ?? { type: 'object', properties: { runId: { type: 'string' }, status: { type: 'string' }, output: {}, usage: { type: 'object' }, durationMs: { type: 'number' } } }} /></section>
      </div>
      <section className="card">
        <h2 className="mb-2 font-semibold">{c('errorsTitle')}</h2>
        <ul className="space-y-1 text-sm">{errors.map(([code, text]) => <li key={code} className="flex gap-3"><code dir="ltr" className="w-10 font-mono text-neutral-500">{code}</code><span>{text}</span></li>)}</ul>
        <a href={`${WWW_URL}/docs/connect`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-medium text-blue-700 hover:underline dark:text-blue-400">{c('readDocs')} ↗</a>
      </section>
    </div>
  );
}
