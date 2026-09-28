/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';

/**
 * Promotes an existing account to full staff (back office access). Sign up through the console
 * first, then run once on the host:
 *   docker compose --env-file /etc/pgcloud/pgcloud.env run --rm staff you@progrid.sa
 * The user must enable two factor sign in before the back office opens for them.
 */
const prisma = new PrismaClient();

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!email.includes('@')) throw new Error('Usage: make-staff <email>');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No account with ${email}. Sign up in the console first.`);
  await prisma.user.update({ where: { id: user.id }, data: { isStaff: true, staffRoles: [] } });
  console.log(`${email} is now full staff. Sign out and in again, then enable two factor sign in under Security.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
