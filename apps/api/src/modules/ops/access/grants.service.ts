import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { AccessGrant, AccessGrantStatus, ManagedPriority, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import type { Actor } from '../../../common/auth/actor';
import { loadConfig } from '../../../config/config';
import { ManagedWorkflows } from '../../managed/managed-workflows.service';
import { ManagedTicketsService } from '../../managed/tickets/tickets.service';
import { OnCallService } from '../../managed/oncall/oncall.service';
import { PagingService } from '../../managed/oncall/paging.service';
import { ManagedNotify } from '../../managed/managed-notify.service';
import { OpsAudit } from '../ops-audit.service';
import { OpsSettingsService } from '../settings/ops-settings.service';
import { checkEligibility } from '../guards/residency';
import type { OpsContext } from '../guards/ops-context';
import { person } from '../serializers/ops-dto';
import { assetPrincipal, decideExtension, decideGrant } from './approval-rules';
import { createSshCa, type SshCertificateAuthority } from './ca/ssh-ca';
import { fingerprint, randomSerial } from './ca/openssh';

export const LIVE_GRANT: AccessGrantStatus[] = ['REQUESTED', 'APPROVED', 'ACTIVE'];
export const grantWorkflowId = (grantId: string) => `ops-grant-${grantId}`;

type GrantRow = AccessGrant & { asset?: { id: string; name: string } | null; ticket?: { id: string; number: number } | null; user?: { id: string; name: string } };
const grantInclude = { asset: { select: { id: true, name: true } }, ticket: { select: { id: true, number: true } }, user: { select: { id: true, name: true } } } satisfies Prisma.AccessGrantInclude;

export function presentGrant(g: GrantRow, now = new Date()) {
  return {
    id: g.id, contractId: g.contractId, assetId: g.assetId, asset: g.asset ? { id: g.asset.id, name: g.asset.name } : undefined, ticketId: g.ticketId, ticket: g.ticket ? { id: g.ticket.id, number: g.ticket.number } : null,
    maintenanceRunId: g.maintenanceRunId, engineer: g.user ? person(g.user) : undefined, reason: g.reason, requestedMinutes: g.requestedMinutes, grantedMinutes: g.grantedMinutes,
    status: g.status, auto: g.auto, emergency: g.emergency, approvedById: g.approvedById, approvedAt: g.approvedAt, denyReason: g.denyReason,
    startsAt: g.startsAt, expiresAt: g.expiresAt, secondsLeft: g.status === 'ACTIVE' && g.expiresAt ? Math.max(0, Math.round((g.expiresAt.getTime() - now.getTime()) / 1000)) : null,
    extensions: g.extensions, extendedAt: g.extendedAt, extensionReason: g.extensionReason, revokedAt: g.revokedAt, revokeReason: g.revokeReason,
    principals: g.principals, certSerial: g.certSerial, createdAt: g.createdAt,
  };
}

export type GrantPlan = { state: 'done' } | { state: 'requested'; expiresAt: string } | { state: 'approved' } | { state: 'active'; expiresAt: string };

type RevokeListener = (grant: AccessGrant, reason: string) => Promise<void>;

/**
 * Access grants (spec 3.3 to 3.8): no standing access, one engineer, one asset, one ticket or
 * maintenance run, for a limited time. The `opsAccessGrant` workflow activates an approved
 * grant, sleeps until it expires and ends it. Revocation (staff, ticket closed, shift end for
 * non emergency grants, suspension, offboarding, losing the assignment) revokes the issued
 * certificates and kills live terminal sessions (the sessions service listens).
 */
@Injectable()
export class GrantsService implements OnModuleInit {
  private readonly log = new Logger(GrantsService.name);
  private readonly revokeListeners: RevokeListener[] = [];
  readonly ca: SshCertificateAuthority;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: ManagedWorkflows,
    private readonly tickets: ManagedTicketsService,
    private readonly oncall: OnCallService,
    private readonly paging: PagingService,
    private readonly notify: ManagedNotify,
    private readonly audit: OpsAudit,
    private readonly settings: OpsSettingsService,
  ) {
    this.ca = createSshCa(prisma);
  }

  onModuleInit() {
    // Closing a ticket, from the ops console, the back office or by the customer, ends its grants.
    this.tickets.onClosed((ticketId) => this.revokeWhere({ ticketId }, 'ticket_closed', null).then(() => undefined));
  }

  /** Called with every revoked or expired grant (the sessions service kills its live sessions). */
  onRevoked(fn: RevokeListener) {
    this.revokeListeners.push(fn);
  }

  // ---- engineer ----

  async request(ops: OpsContext, dto: { assetId: string; ticketId?: string; maintenanceRunId?: string; reason: string; durationMin: number }) {
    if (!!dto.ticketId === !!dto.maintenanceRunId) throw ApiError.invalid('Pass ticketId or maintenanceRunId');
    const asset = await this.prisma.managedAsset.findUniqueOrThrow({ where: { id: dto.assetId } });
    if (asset.status !== 'APPROVED' || asset.removedAt) throw ApiError.invalidState('The asset is not approved');
    if (asset.kind === 'SITE') throw ApiError.invalid('A site has no shell to open; pick a server');
    if (!asset.managementAddress) throw ApiError.invalidState('The asset has no management address yet');
    let priority: ManagedPriority | null = null;
    if (dto.ticketId) {
      const t = await this.prisma.ticket.findUniqueOrThrow({ where: { id: dto.ticketId } });
      if (t.contractId !== asset.contractId) throw ApiError.invalid('The ticket and the asset belong to different contracts');
      if (t.assetId && t.assetId !== asset.id) throw ApiError.invalid('The ticket is about another asset');
      if (t.status !== 'open' && t.status !== 'answered') throw ApiError.invalidState('The ticket is closed');
      priority = t.managedPriority;
    } else {
      const run = await this.prisma.maintenanceRun.findUniqueOrThrow({ where: { id: dto.maintenanceRunId }, include: { task: true } });
      if (run.task.contractId !== asset.contractId || (run.task.assetId && run.task.assetId !== asset.id)) throw ApiError.invalid('The maintenance run does not cover this asset');
    }
    const eligible = await checkEligibility(this.prisma, ops.userId, asset.contractId);
    if (!eligible.ok) throw new ApiError(403, eligible.reason === 'residency' ? 'residency_blocked' : 'forbidden', eligible.message);
    const s = await this.settings.get();
    const onCall = await this.onCallNow(ops.userId);
    const decision = decideGrant({ priority, onCall, assetAssigned: true, requestedMinutes: dto.durationMin }, s);
    if (!decision.ok) throw ApiError.invalid(decision.message);
    const duplicate = await this.prisma.accessGrant.findFirst({ where: { userId: ops.userId, assetId: asset.id, ticketId: dto.ticketId ?? null, maintenanceRunId: dto.maintenanceRunId ?? null, status: { in: LIVE_GRANT } } });
    if (duplicate) throw ApiError.conflict('grant_exists', `You already have a ${duplicate.status.toLowerCase()} grant for this asset and ticket (${duplicate.id})`);
    const grant = await this.prisma.accessGrant.create({
      data: {
        userId: ops.userId, engineerId: ops.profile?.id ?? null, contractId: asset.contractId, assetId: asset.id, ticketId: dto.ticketId ?? null, maintenanceRunId: dto.maintenanceRunId ?? null,
        reason: dto.reason, requestedMinutes: dto.durationMin, emergency: decision.emergency, auto: decision.auto, principals: [assetPrincipal(asset.id)],
        ...(decision.auto ? { status: 'APPROVED', grantedMinutes: decision.minutes, approvedAt: new Date() } : {}),
      },
    });
    await this.audit.emit('ops.grant_requested', ops, { contractId: grant.contractId, assetId: grant.assetId, ticketId: grant.ticketId, grantId: grant.id, minutes: dto.durationMin, auto: decision.auto, rule: decision.why }, `access_grant:${grant.id}`);
    if (decision.auto) {
      await this.audit.emit('ops.grant_approved', ops, { contractId: grant.contractId, assetId: grant.assetId, ticketId: grant.ticketId, grantId: grant.id, auto: true, minutes: decision.minutes }, `access_grant:${grant.id}`);
      await this.startWorkflow(grant.id);
    } else {
      await this.startWorkflow(grant.id);
      await this.askLead(ops, grant, decision.why);
    }
    return this.presentOne(grant.id);
  }

  async listMine(ops: OpsContext, q: { status?: AccessGrantStatus | 'live' }) {
    const rows = await this.prisma.accessGrant.findMany({
      where: { userId: ops.userId, ...(q.status === 'live' ? { status: { in: LIVE_GRANT } } : q.status ? { status: q.status } : {}) },
      include: grantInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { data: rows.map((g) => presentGrant(g)) };
  }

  async getMine(ops: OpsContext, id: string) {
    const g = await this.prisma.accessGrant.findFirst({ where: { id, userId: ops.userId }, include: grantInclude });
    if (!g) throw ApiError.notFound('access grant', id);
    return presentGrant(g);
  }

  /** One extension with a reason (settings.maxExtensions), counted from the current expiry. */
  async extend(ops: OpsContext, id: string, dto: { reason: string; minutes: number }) {
    const g = await this.prisma.accessGrant.findFirst({ where: { id, userId: ops.userId } });
    if (!g) throw ApiError.notFound('access grant', id);
    const s = await this.settings.get();
    const d = decideExtension(g, dto.minutes, s);
    if (!d.ok) throw d.code === 'extension_used' ? ApiError.conflict(d.code, d.message) : d.code === 'not_active' ? ApiError.invalidState(d.message) : ApiError.invalid(d.message);
    const updated = await this.prisma.accessGrant.updateMany({ where: { id, status: 'ACTIVE', extensions: g.extensions }, data: { expiresAt: d.expiresAt, extensions: { increment: 1 }, extendedAt: new Date(), extensionReason: dto.reason } });
    if (!updated.count) throw ApiError.conflict('extension_used', 'The grant changed; reload it');
    await this.workflows.signal(grantWorkflowId(id), 'grantChanged');
    await this.audit.emit('ops.grant_extended', ops, { contractId: g.contractId, assetId: g.assetId, ticketId: g.ticketId, grantId: id, minutes: dto.minutes, reason: dto.reason, expiresAt: d.expiresAt.toISOString() }, `access_grant:${id}`);
    return this.presentOne(id);
  }

  // ---- support lead ----

  async adminList(q: { status?: AccessGrantStatus | 'live'; userId?: string; contractId?: string; assetId?: string }) {
    const rows = await this.prisma.accessGrant.findMany({
      where: {
        ...(q.status === 'live' ? { status: { in: LIVE_GRANT } } : q.status ? { status: q.status } : {}),
        ...(q.userId ? { userId: q.userId } : {}), ...(q.contractId ? { contractId: q.contractId } : {}), ...(q.assetId ? { assetId: q.assetId } : {}),
      },
      include: grantInclude,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return { data: rows.map((g) => presentGrant(g)) };
  }

  async adminGet(id: string) {
    return this.presentOne(id);
  }

  /** A support lead approves a REQUESTED grant (never their own), for at most maxGrantMinutes. */
  async approve(actor: Actor, id: string, dto: { minutes?: number }) {
    const g = await this.prisma.accessGrant.findUnique({ where: { id } });
    if (!g) throw ApiError.notFound('access grant', id);
    if (g.userId === actor.userId) throw ApiError.forbidden('You cannot approve your own access');
    if (g.status !== 'REQUESTED') throw ApiError.invalidState(`The grant is ${g.status.toLowerCase()}`);
    const s = await this.settings.get();
    const minutes = Math.min(dto.minutes ?? g.requestedMinutes, s.maxGrantMinutes);
    const eligible = await checkEligibility(this.prisma, g.userId, g.contractId);
    if (!eligible.ok) throw new ApiError(403, eligible.reason === 'residency' ? 'residency_blocked' : 'forbidden', eligible.message);
    const r = await this.prisma.accessGrant.updateMany({ where: { id, status: 'REQUESTED' }, data: { status: 'APPROVED', grantedMinutes: minutes, approvedById: actor.userId, approvedAt: new Date() } });
    if (!r.count) throw ApiError.invalidState('The grant changed; reload it');
    await this.audit.emit('ops.grant_approved', actor, { contractId: g.contractId, assetId: g.assetId, ticketId: g.ticketId, grantId: id, auto: false, minutes }, `access_grant:${id}`);
    if (!(await this.workflows.signal(grantWorkflowId(id), 'grantChanged'))) {
      // The workflow is gone (or Temporal is down): activate here and start it for the expiry.
      await this.activate(id);
      await this.startWorkflow(id);
    }
    return this.presentOne(id);
  }

  async deny(actor: Actor, id: string, reason: string) {
    const g = await this.prisma.accessGrant.findUnique({ where: { id } });
    if (!g) throw ApiError.notFound('access grant', id);
    if (g.status !== 'REQUESTED') throw ApiError.invalidState(`The grant is ${g.status.toLowerCase()}`);
    await this.prisma.accessGrant.updateMany({ where: { id, status: 'REQUESTED' }, data: { status: 'DENIED', deniedById: actor.userId, denyReason: reason } });
    await this.workflows.signal(grantWorkflowId(id), 'grantChanged');
    await this.audit.emit('ops.grant_denied', actor, { contractId: g.contractId, assetId: g.assetId, ticketId: g.ticketId, grantId: id, reason }, `access_grant:${id}`);
    const u = await this.prisma.user.findUnique({ where: { id: g.userId }, select: { email: true } });
    if (u) await this.notify.send({ to: u.email, subject: 'Your access request was denied', text: `${reason}\n${loadConfig().PRGD_OPS_URL}/access` });
    return this.presentOne(id);
  }

  async revoke(who: Actor | OpsContext | null, id: string, reason: string) {
    const g = await this.prisma.accessGrant.findUnique({ where: { id } });
    if (!g) throw ApiError.notFound('access grant', id);
    if (!LIVE_GRANT.includes(g.status)) throw ApiError.invalidState(`The grant is ${g.status.toLowerCase()}`);
    await this.end(g, 'REVOKED', reason, who);
    return this.presentOne(id);
  }

  /** Revokes every live grant matching `where` (ticket closed, shift end, offboarding, lost assignment). */
  async revokeWhere(where: Prisma.AccessGrantWhereInput, reason: string, who: Actor | OpsContext | null) {
    const rows = await this.prisma.accessGrant.findMany({ where: { ...where, status: { in: LIVE_GRANT } } });
    for (const g of rows) await this.end(g, 'REVOKED', reason, who).catch((e) => this.log.error(`revoking grant ${g.id}: ${(e as Error).message}`));
    return rows.length;
  }

  // ---- certificates (the gateway's session check) ----

  /**
   * Signs the gateway's ephemeral public key for an ACTIVE grant: principals limited to the
   * asset, valid from a minute ago until the grant expires.
   */
  async issueCertificate(grant: AccessGrant, publicKey: string, sessionId: string) {
    if (grant.status !== 'ACTIVE' || !grant.expiresAt || grant.expiresAt <= new Date()) throw ApiError.invalidState('The grant is not active');
    const serial = randomSerial();
    const keyId = `prgd-session-${sessionId}`;
    const validAfter = new Date(Date.now() - 60_000);
    const certificate = await this.ca.sign({ publicKey, serial, keyId, principals: grant.principals, validAfter, validBefore: grant.expiresAt });
    await this.prisma.sshCertificate.create({ data: { grantId: grant.id, sessionId, serial: serial.toString(), keyId, principals: grant.principals, fingerprint: fingerprint(publicKey), validAfter, validBefore: grant.expiresAt, ca: this.ca.name } });
    await this.prisma.accessGrant.update({ where: { id: grant.id }, data: { certSerial: serial.toString() } });
    await this.audit.emit('ops.certificate_issued', null, { contractId: grant.contractId, assetId: grant.assetId, ticketId: grant.ticketId, grantId: grant.id, sessionId, serial: serial.toString(), principals: grant.principals, validBefore: grant.expiresAt.toISOString(), ca: this.ca.name }, `access_grant:${grant.id}`);
    return { certificate, serial: serial.toString(), principals: grant.principals, validBefore: grant.expiresAt };
  }

  // ---- workflow steps ----

  async plan(id: string): Promise<GrantPlan> {
    const g = await this.prisma.accessGrant.findUnique({ where: { id } });
    if (!g) return { state: 'done' };
    if (g.status === 'REQUESTED') {
      const s = await this.settings.get();
      return { state: 'requested', expiresAt: new Date(g.createdAt.getTime() + s.grantRequestExpiryMinutes * 60_000).toISOString() };
    }
    if (g.status === 'APPROVED') return { state: 'approved' };
    if (g.status === 'ACTIVE' && g.expiresAt) return { state: 'active', expiresAt: g.expiresAt.toISOString() };
    return { state: 'done' };
  }

  /** APPROVED to ACTIVE: the certificate window starts now and ends after the granted minutes. */
  async activate(id: string) {
    const g = await this.prisma.accessGrant.findUnique({ where: { id } });
    if (!g || g.status !== 'APPROVED') return g?.status ?? 'missing';
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (g.grantedMinutes ?? g.requestedMinutes) * 60_000);
    const r = await this.prisma.accessGrant.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'ACTIVE', startsAt: now, expiresAt } });
    if (r.count) {
      await this.audit.emit('ops.grant_active', null, { contractId: g.contractId, assetId: g.assetId, ticketId: g.ticketId, grantId: id, expiresAt: expiresAt.toISOString(), principals: g.principals, ca: this.ca.name }, `access_grant:${id}`);
      const u = await this.prisma.user.findUnique({ where: { id: g.userId }, select: { email: true } });
      if (u && !g.auto) await this.notify.send({ to: u.email, subject: 'Your access request was approved', text: `Access until ${expiresAt.toISOString()}.\n${loadConfig().PRGD_OPS_URL}/access` });
    }
    return 'ACTIVE';
  }

  /** Ends an ACTIVE grant past its expiry, or a request nobody decided in time. */
  async expire(id: string) {
    const g = await this.prisma.accessGrant.findUnique({ where: { id } });
    if (!g) return 'missing';
    const plan = await this.plan(id);
    const now = Date.now();
    if (plan.state === 'active' && new Date(plan.expiresAt).getTime() <= now) await this.end(g, 'EXPIRED', 'expired', null);
    else if (plan.state === 'requested' && new Date(plan.expiresAt).getTime() <= now) await this.end(g, 'EXPIRED', 'request not decided in time', null);
    return (await this.prisma.accessGrant.findUniqueOrThrow({ where: { id } })).status;
  }

  // ---- helpers ----

  private async end(g: AccessGrant, status: 'REVOKED' | 'EXPIRED', reason: string, who: Actor | OpsContext | null) {
    const now = new Date();
    const actorId = who?.userId ?? null;
    const r = await this.prisma.accessGrant.updateMany({ where: { id: g.id, status: { in: LIVE_GRANT } }, data: { status, revokedAt: now, revokeReason: reason, revokedById: actorId } });
    if (!r.count) return;
    const certs = await this.prisma.sshCertificate.findMany({ where: { grantId: g.id, revokedAt: null, validBefore: { gt: now } } });
    for (const c of certs) {
      await this.ca.revoke(c.serial, reason).catch((e) => this.log.warn(`revoking certificate ${c.serial} at ${this.ca.name}: ${(e as Error).message}`));
    }
    await this.prisma.sshCertificate.updateMany({ where: { grantId: g.id, revokedAt: null }, data: { revokedAt: now } });
    await this.workflows.signal(grantWorkflowId(g.id), 'grantChanged');
    await this.audit.emit(status === 'EXPIRED' ? 'ops.grant_expired' : 'ops.grant_revoked', who, { contractId: g.contractId, assetId: g.assetId, ticketId: g.ticketId, grantId: g.id, reason, certificatesRevoked: certs.length }, `access_grant:${g.id}`);
    for (const fn of this.revokeListeners) await fn({ ...g, status }, reason).catch((e) => this.log.error(`grant ${g.id} revoke listener: ${(e as Error).message}`));
  }

  private async startWorkflow(id: string) {
    const ok = await this.workflows.start('opsAccessGrant', [{ grantId: id }], grantWorkflowId(id));
    if (!ok) await this.activate(id);
  }

  /** On call now: a PRIMARY or SECONDARY shift covering this moment that the engineer has not ended. */
  private async onCallNow(userId: string) {
    const now = new Date();
    return !!(await this.prisma.onCallShift.findFirst({ where: { userId, startsAt: { lte: now }, endsAt: { gt: now } } }));
  }

  private async askLead(ops: OpsContext, g: AccessGrant, why: string) {
    const lead = await this.oncall.supportLead(ops.userId);
    const asset = await this.prisma.managedAsset.findUnique({ where: { id: g.assetId }, select: { name: true } });
    const subject = `Access request: ${ops.name} on ${asset?.name ?? g.assetId} for ${g.requestedMinutes} minutes`;
    const message = `${g.reason} (${why}). Approve or deny in the back office: /admin/ops/access/grants/${g.id}`;
    if (!lead) return this.notify.toStaff({ subject, text: message });
    await this.notify.send({ to: lead.email, subject, text: `${message}\n${loadConfig().CONSOLE_URL}/admin/ops/access` });
    await this.paging.page({ userId: lead.id, urgency: 'low', subject, message, ticketId: g.ticketId ?? undefined }).catch((e) => this.log.warn(`access request page failed: ${(e as Error).message}`));
  }

  private async presentOne(id: string) {
    return presentGrant(await this.prisma.accessGrant.findUniqueOrThrow({ where: { id }, include: grantInclude }));
  }
}
