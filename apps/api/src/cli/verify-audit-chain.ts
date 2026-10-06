/**
 * Walks the audit log hash chain and exits non zero when a row was changed, removed from the
 * middle or reordered. Also served as GET /admin/v1/audit/verify.
 *
 *   node dist/cli/verify-audit-chain.js                          (production image)
 *   npx ts-node --transpile-only src/cli/verify-audit-chain.ts   (development)
 */
import { PrismaClient } from '@prisma/client';
import { verifyAuditChain } from '../modules/events/audit-chain';

const prisma = new PrismaClient();
verifyAuditChain(prisma)
  .then(async (r) => {
    console.log(JSON.stringify(r, null, 2));
    await prisma.$disconnect();
    process.exit(r.ok ? 0 : 2);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
