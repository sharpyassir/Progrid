import type { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Called when someone proves they own an account's mailbox (a password reset link, or Google or
 * Microsoft vouching for the address) while the account's email was still unconfirmed. Any
 * linked identity whose provider did not vouch for that same address may belong to whoever
 * created the account with someone else's address, so it is removed (account pre hijacking).
 * Returns how many were removed.
 */
export async function dropUnprovenIdentities(prisma: PrismaService, userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true } });
  if (!user || user.emailVerified) return 0;
  const r = await prisma.oAuthIdentity.deleteMany({ where: { userId, email: user.email, emailVerified: false } });
  return r.count;
}
