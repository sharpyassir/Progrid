import { describe, expect, it } from 'vitest';
import { assetTags, suggestRunbooks, words } from './runbook-suggest';

const runbooks = [
  { id: '1', slug: 'disk-full', title: 'Disk full on Linux servers', tags: ['disk', 'linux'] },
  { id: '2', slug: 'acme-web', title: 'Acme web stack', tags: ['contract:c1'] },
  { id: '3', slug: 'host-down', title: 'Host down or unreachable', tags: ['hostdown'] },
  { id: '4', slug: 'certs', title: 'Renew TLS certificates', tags: ['tls'] },
];

describe('runbook suggestions', () => {
  it('splits alert names and drops short and common words', () => {
    expect(words('HostDown on web-1')).toEqual(expect.arrayContaining(['host', 'down', 'hostdown', 'web']));
    expect(words('the and it')).toEqual([]);
  });

  it('ranks alert names and contract tags above ticket text', () => {
    const tags = assetTags({ id: 'a1', contractId: 'c1', kind: 'EXTERNAL_SERVER', os: 'Ubuntu 24.04', provider: 'Hetzner' });
    expect(tags).toEqual(expect.arrayContaining(['asset:a1', 'contract:c1', 'external_server', 'ubuntu', 'hetzner']));
    const out = suggestRunbooks(runbooks, { assetTags: tags, alertNames: ['HostDown'], text: 'The disk is full again' });
    expect(out.map((r) => r.slug)).toEqual(['host-down', 'acme-web', 'disk-full']);
    expect(out[1]).toMatchObject({ score: 5, reasons: ['tag contract:c1'] });
    expect(out.find((r) => r.slug === 'certs')).toBeUndefined();
  });
});
