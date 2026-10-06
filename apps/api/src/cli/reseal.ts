/**
 * Re-encrypts every sealed column with the active key of SECRETS_KEYS (or SECRETS_KEY), and
 * seals values that are still in clear (rows from before encryption at rest). Safe to run
 * repeatedly and while the API runs: values already on the active key are skipped.
 *
 *   node dist/cli/reseal.js [--dry-run]                                     (production image)
 *   npx ts-node --transpile-only src/cli/reseal.ts [--dry-run]              (development)
 *
 * See docs/security/key-management.md (rotation).
 */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { isCurrent, isSealedJson, keyring, open, openJson, seal, sealJson } from '../common/crypto/secretbox';

type Kind = 'string' | 'json';
interface Target {
  model: string;
  fields: Record<string, Kind>;
}

/** Every column that holds a sealed value. Keep in sync with the seal() call sites. */
export const SEALED_COLUMNS: Target[] = [
  { model: 'user', fields: { totpSecret: 'string' } },
  { model: 'webhook', fields: { secret: 'string' } },
  { model: 'dbCluster', fields: { adminPassword: 'string', vmSecret: 'string', backupSecretKey: 'string' } },
  { model: 'dbUser', fields: { password: 'string' } },
  { model: 'kubeCluster', fields: { vmSecret: 'string', joinToken: 'string', certKey: 'string', kubeconfig: 'string', backupSecretKey: 'string' } },
  { model: 'loadBalancer', fields: { vmSecret: 'string' } },
  { model: 'appHost', fields: { vmSecret: 'string' } },
  { model: 'platformApp', fields: { gitToken: 'string', envVars: 'json' } },
  { model: 'deployment', fields: { webhookSecret: 'string', vmSecret: 'string', envVars: 'json' } },
  { model: 'storageKey', fields: { secretKey: 'string' } },
  { model: 'server', fields: { userData: 'string' } },
  { model: 'sshCaKey', fields: { privateKey: 'string' } },
  { model: 'opsSecret', fields: { values: 'string' } },
  { model: 'connectConnection', fields: { secret: 'string' } },
  { model: 'connectVariable', fields: { value: 'string' } },
  { model: 'connectWebhook', fields: { signingSecret: 'string' } },
  { model: 'affiliate', fields: { payoutDetails: 'string' } },
  { model: 'affiliateTaxForm', fields: { tin: 'string' } },
];

type Delegate = {
  findMany(args: unknown): Promise<Record<string, unknown>[]>;
  update(args: unknown): Promise<unknown>;
};

/** The new value for one column, or undefined when it is already current. */
export function resealValue(kind: Kind, v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (kind === 'json') {
    if (isSealedJson(v)) return isCurrent(v.enc) ? undefined : sealJson(openJson(v));
    // A plain map from before encryption (an empty one has nothing to hide).
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length) return sealJson(openJson(v));
    return undefined;
  }
  if (typeof v !== 'string' || v === '') return undefined;
  if (isCurrent(v)) return undefined;
  return seal(open(v));
}

export async function reseal(prisma: PrismaClient, opts: { dryRun?: boolean; log?: (s: string) => void } = {}) {
  const log = opts.log ?? ((s: string) => console.log(s));
  const ring = keyring();
  log(`active key: ${ring.active ? ring.active.kid : 'none (legacy v1; set SECRETS_KEYS first)'}${opts.dryRun ? ' (dry run)' : ''}`);
  const totals: Record<string, number> = {};
  for (const t of SEALED_COLUMNS) {
    const delegate = (prisma as unknown as Record<string, Delegate>)[t.model];
    const select = Object.fromEntries([['id', true], ...Object.keys(t.fields).map((f) => [f, true])]);
    let cursor: string | undefined;
    let changed = 0;
    for (;;) {
      const rows = await delegate.findMany({ select, orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!rows.length) break;
      for (const r of rows) {
        const data: Record<string, unknown> = {};
        for (const [f, kind] of Object.entries(t.fields)) {
          const next = resealValue(kind, r[f]);
          if (next !== undefined) data[f] = next;
        }
        if (Object.keys(data).length) {
          changed++;
          if (!opts.dryRun) await delegate.update({ where: { id: r.id }, data });
        }
      }
      cursor = rows[rows.length - 1].id as string;
    }
    totals[t.model] = changed;
    log(`${t.model}: ${changed} rows ${opts.dryRun ? 'would be' : ''} resealed`);
  }
  return totals;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  reseal(prisma, { dryRun: process.argv.includes('--dry-run') })
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
