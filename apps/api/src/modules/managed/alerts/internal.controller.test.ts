import { describe, expect, it } from 'vitest';
import { secretMatches } from './internal.controller';
import { alertmanagerPayload } from './alerts.service';

describe('webhook secret', () => {
  it('matches only the configured secret', () => {
    expect(secretMatches('s3cret', 's3cret')).toBe(true);
    expect(secretMatches('s3cre', 's3cret')).toBe(false);
    expect(secretMatches('s3cret-and-more', 's3cret')).toBe(false);
    expect(secretMatches('', 's3cret')).toBe(false);
    // No secret configured refuses everything.
    expect(secretMatches('anything', undefined)).toBe(false);
    expect(secretMatches('', '')).toBe(false);
  });
});

describe('Alertmanager payload', () => {
  it('accepts the v4 webhook shape', () => {
    const r = alertmanagerPayload.safeParse({
      version: '4', status: 'firing', receiver: 'prgd', groupKey: 'k', groupLabels: {}, commonLabels: {}, commonAnnotations: {}, externalURL: 'http://am', truncatedAlerts: 0,
      alerts: [{ status: 'firing', labels: { alertname: 'HostDown', asset_id: 'a1', severity: 'critical' }, annotations: { summary: 'down' }, startsAt: '2026-10-01T10:00:00Z', endsAt: '0001-01-01T00:00:00Z', generatorURL: 'http://p', fingerprint: 'abc' }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects alerts without a fingerprint', () => {
    expect(alertmanagerPayload.safeParse({ alerts: [{ status: 'firing', labels: {} }] }).success).toBe(false);
  });
});
