import { Injectable, Logger } from '@nestjs/common';
import { teamEntity } from '../../common/entities/lookup';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService, type Mail } from '../../common/mail/mail.service';
import { loadConfig } from '../../config/config';

/** Email helpers for the managed cloud module. Failures are logged, never thrown. */
@Injectable()
export class ManagedNotify {
  private readonly log = new Logger(ManagedNotify.name);
  constructor(private readonly prisma: PrismaService, private readonly mail: MailService) {}

  /** Addresses of the team owners (CUSTOMER_OWNER). */
  async ownerEmails(teamId: string) {
    const owners = await this.prisma.teamMember.findMany({ where: { teamId, role: 'owner' }, include: { user: { select: { email: true } } } });
    return [...new Set(owners.map((o) => o.user.email))];
  }

  async toOwners(teamId: string, mail: Omit<Mail, 'to'>) {
    const to = await this.ownerEmails(teamId);
    const entity = mail.entity ?? (await teamEntity(this.prisma, teamId));
    await Promise.all(to.map((email) => this.send({ ...mail, entity, to: email })));
    return to;
  }

  /** The staff inbox (SUPPORT_INBOX); skipped when it is empty. */
  async toStaff(mail: Omit<Mail, 'to'>) {
    const inbox = loadConfig().SUPPORT_INBOX;
    if (inbox) await this.send({ ...mail, to: inbox });
  }

  async send(mail: Mail) {
    await this.mail.send(mail).catch((e) => this.log.warn(`managed mail to ${mail.to} failed: ${(e as Error).message}`));
  }
}
