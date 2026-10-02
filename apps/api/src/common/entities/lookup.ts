import type { BillingEntity, PrismaClient } from '@prisma/client';

type Db = Pick<PrismaClient, 'team' | 'teamMember'>;

/** The team's contracting company, for mails and links outside a request. */
export async function teamEntity(db: Db, teamId: string | null | undefined): Promise<BillingEntity | undefined> {
  if (!teamId) return undefined;
  const t = await db.team.findUnique({ where: { id: teamId }, select: { billingEntity: true } });
  return t?.billingEntity;
}

/** A person's company for account mails (verification, password reset): that of their first team. */
export async function userEntity(db: Db, userId: string): Promise<BillingEntity | undefined> {
  const m = await db.teamMember.findFirst({ where: { userId }, orderBy: { teamId: 'asc' }, select: { team: { select: { billingEntity: true } } } });
  return m?.team.billingEntity;
}
