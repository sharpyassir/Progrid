/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';

/**
 * Promotes an existing account to staff (back office access). Sign up through the console
 * first, then run once on the host:
 *   docker compose --env-file /etc/prgd/prgd.env run --rm staff you@progrid.sa [role,role]
 * Without roles the account gets full_admin (the whole back office). Limited roles: support,
 * finance, ops, engineer, support_lead. The user must enable two factor sign in before the
 * back office opens for them.
 */
const prisma = new PrismaClient();
// Same list as STAFF_ROLES in src/common/auth/actor.ts (the production image runs this file without src).
const STAFF_ROLES = ['full_admin', 'support', 'finance', 'ops', 'engineer', 'support_lead'];

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!email.includes('@')) throw new Error(`Usage: make-staff <email> [${STAFF_ROLES.join(',')}]`);
  const roles = (process.argv[3] ?? 'full_admin').split(',').map((r) => r.trim()).filter(Boolean);
  const unknown = roles.filter((r) => !STAFF_ROLES.includes(r));
  if (!roles.length || unknown.length) throw new Error(`Unknown role(s): ${unknown.join(', ') || '(none)'}. Roles: ${STAFF_ROLES.join(', ')}`);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No account with ${email}. Sign up in the console first.`);
  await prisma.user.update({ where: { id: user.id }, data: { isStaff: true, staffRoles: roles } });
  // Role changes apply to new sessions; end the old ones.
  await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  console.log(`${email} is now staff (${roles.join(', ')}). Sign in again, then enable two factor sign in under Security.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
