import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { loadConfig } from '../../config/config';
import { EventsService } from '../events/events.service';
import { BILLING_SUSPENSION, TrustService } from '../trust/trust.service';

/** Days past the due date at which a reminder goes out. The last one also suspends the team. */
export const REMINDER_DAYS = [3, 7, 14] as const;
const SUSPEND_AT = 14;
const DAY = 86_400_000;

/** The reminder stage an invoice has reached this many days past due (0 when none yet). */
export function reminderStageFor(daysOverdue: number): number {
  return [...REMINDER_DAYS].reverse().find((d) => daysOverdue >= d) ?? 0;
}

/**
 * Daily dunning: reminders for unpaid invoices at 3, 7 and 14 days past due, and suspension
 * at 14 days. Each invoice records the last stage sent, so a rerun never mails twice; when
 * the job missed days only the latest stage is sent.
 */
@Injectable()
export class DunningService {
  private readonly log = new Logger(DunningService.name);

  constructor(private readonly prisma: PrismaService, private readonly mail: MailService, private readonly events: EventsService, private readonly trust: TrustService) {}

  async run(now = new Date()) {
    const overdue = await this.prisma.invoice.findMany({
      where: { status: 'open', dueAt: { lt: new Date(now.getTime() - REMINDER_DAYS[0] * DAY) }, reminderStage: { lt: SUSPEND_AT } },
      include: { team: { select: { id: true, name: true, status: true } } },
      orderBy: { dueAt: 'asc' },
    });
    let reminded = 0;
    let suspended = 0;
    for (const inv of overdue) {
      try {
        const days = Math.floor((now.getTime() - inv.dueAt!.getTime()) / DAY);
        const stage = reminderStageFor(days);
        if (stage <= inv.reminderStage) continue;
        const due = inv.totalMinor - inv.creditedMinor;
        if (due <= 0) continue;
        // Claim the stage first so a second replica or a rerun cannot send it again.
        const claimed = await this.prisma.invoice.updateMany({ where: { id: inv.id, reminderStage: inv.reminderStage }, data: { reminderStage: stage, lastReminderAt: now } });
        if (!claimed.count) continue;
        const suspend = stage >= SUSPEND_AT && inv.team.status !== 'closed';
        await this.remind(inv.teamId, inv.number, due, inv.currency, days, suspend);
        await this.events.emit('invoice.overdue', { invoiceId: inv.id, number: inv.number, daysOverdue: days, stage }, { teamId: inv.teamId, resource: `invoice:${inv.id}` });
        reminded++;
        if (suspend && inv.team.status !== 'suspended') {
          await this.trust.suspend(inv.teamId, `${BILLING_SUSPENSION} invoice ${inv.number} is ${days} days overdue`);
          suspended++;
        }
      } catch (err) {
        this.log.error(`dunning for invoice ${inv.number} failed: ${(err as Error).message}`);
      }
    }

    // Retry power off for suspended teams whose servers did not all stop last time.
    const teams = await this.prisma.team.findMany({ where: { status: 'suspended', projects: { some: { servers: { some: { status: 'active', deletedAt: null } } } } }, select: { id: true } });
    for (const t of teams) {
      await this.trust.enforceSuspension(t.id).catch((e) => this.log.error(`power off for suspended team ${t.id} failed: ${(e as Error).message}`));
    }
    this.log.log(`dunning: ${reminded} reminders, ${suspended} teams suspended`);
    return { reminded, suspended };
  }

  private async remind(teamId: string, number: string, dueMinor: number, currency: string, days: number, suspend: boolean) {
    const people = await this.prisma.teamMember.findMany({ where: { teamId, role: { in: ['owner', 'billing'] } }, include: { user: { select: { email: true, name: true } } } });
    const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(dueMinor / 100);
    const url = `${loadConfig().CONSOLE_URL}/billing`;
    const subject = suspend ? `Account suspended: invoice ${number} is ${days} days overdue` : `Reminder: invoice ${number} (${amount}) is ${days} days overdue`;
    const body = suspend
      ? `Your invoice ${number} for ${amount} is ${days} days past its due date, so your account is now suspended. Your servers have been powered off and your data is kept. API tokens and the console only work for billing until the invoice is paid.\nPay it here and everything powers back on automatically:\n${url}`
      : `Your invoice ${number} for ${amount} is ${days} days past its due date. Please pay it by card here:\n${url}\n\nIf it is still unpaid ${SUSPEND_AT} days after the due date, the account is suspended and its servers are powered off.`;
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { billingEmail: true } });
    const to = new Set(people.map((m) => m.user.email));
    if (team?.billingEmail) to.add(team.billingEmail);
    const names = new Map(people.map((m) => [m.user.email, m.user.name]));
    await Promise.all([...to].map((email) => this.mail.send({ to: email, subject, text: `Hi ${names.get(email) ?? 'there'},\n\n${body}\n\nIf you already paid, thank you, and please ignore this message.` })));
  }
}
