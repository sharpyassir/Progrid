import { describe, expect, it } from 'vitest';
import { assertProductionSecrets, type AppConfig } from './config';

const strong = (s: string) => `${s}-${'x'.repeat(40)}`;
const base = { JWT_SECRET: strong('jwt'), SECRETS_KEY: strong('sk'), NATS_TOKEN: strong('nats'), PRGD_GATEWAY_SECRET: strong('gw') } as unknown as AppConfig;

describe('production secret guard', () => {
  it('accepts strong, distinct secrets', () => {
    expect(() => assertProductionSecrets(base, {})).not.toThrow();
  });
  it('refuses placeholders and short values', () => {
    expect(() => assertProductionSecrets({ ...base, JWT_SECRET: 'please-change-me-0123456789abcdefghij' }, {})).toThrow(/JWT_SECRET/);
    expect(() => assertProductionSecrets({ ...base, NATS_TOKEN: 'short' }, {})).toThrow(/NATS_TOKEN/);
    expect(() => assertProductionSecrets(base, { PRGD_PLATFORM_HEARTBEAT_SECRET: 'tiny' })).toThrow(/HEARTBEAT/);
    expect(() => assertProductionSecrets({ ...base, SECRETS_KEYS: 'k1:abc' } as AppConfig, {})).toThrow(/SECRETS_KEYS\[0\]/);
  });
  it('requires JWT_SECRET to differ from the encryption keys', () => {
    expect(() => assertProductionSecrets({ ...base, SECRETS_KEY: base.JWT_SECRET }, {})).toThrow(/differ/);
    expect(() => assertProductionSecrets({ ...base, SECRETS_KEY: undefined, SECRETS_KEYS: `k1:${base.JWT_SECRET}` } as AppConfig, {})).toThrow(/differ/);
  });
});
