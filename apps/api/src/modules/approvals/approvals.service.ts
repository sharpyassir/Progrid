import { Injectable, Logger } from '@nestjs/common';
import { teamEntity } from '../../common/entities/lookup';
import { Prisma, type Approval } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { ApiError } from '../../common/errors/api-error';
import { EventsService } from '../events/events.service';
import { loadConfig } from '../../config/config';
import type { Actor } from '../../common/auth/actor';
import { scopesForRole } from '../../common/auth/actor';

export interface ApprovalRequest {
  /** e.g. "servers:delete", "servers:resize-down", "servers:create" */
  kind: string;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  /** Human readable, one line: "Delete server web-1 (s-2vcpu-4gb, 203.0.113.3)" */
  summary: string;
  /** Everything needed to run the action later. */
  payload: Record<string, unknown>;
  projectId: string;
}

type Executor = (actor: Actor, approval: Approval) => Promise<unknown>;
type DenyHandler = (actor: Actor, approval: Approval, reason?: string) => Promise<void>;

const TTL_HOURS = 24;

/**
 * Human in the loop for agent tokens. An agent token whose `requireApprovalFor` includes the
 * action gets a pending Approval instead of the action; team owners and admins get an email and a
 * webhook event; approving runs the original request with the token's own limits still applied.
 * Modules register an executor per kind so this service never depends on them.
 */
@Injectable()
export class ApprovalsService {
  private readonly log = new Logger(ApprovalsService.name);
  private readonly executors = new Map<string, Executor>();
  private readonly denyHandlers = new Map<string, DenyHandler>();

  constructor(private readonly prisma: PrismaService, private readonly mail: MailService, private readonly events: EventsService) {}

  registerExecutor(kind: string, fn: Executor) {
    this.executors.set(kind, fn);
  }

  /** Runs after a person denies a request of this kind (Connect fails the waiting run). */
  onDenied(kind: string, fn: DenyHandler) {
    this.denyHandlers.set(kind, fn);
  }

  /**
   * Records a pending request and notifies the team without throwing. Used by callers that
   * park their own work (Connect runs wait in waiting_approval) instead of failing the request.
   */
  async createPending(actor: Actor, req: ApprovalRequest): Promise<Approval> {
    const approval = await this.prisma.approval.create({
      data: {
        teamId: actor.teamId,
        projectId: req.projectId,
        tokenId: actor.tokenId,
        requestedById: actor.userId,
        kind: req.kind,
        resourceType: req.resourceType,
        resourceId: req.resourceId,
        resourceName: req.resourceName,
        summary: req.summary,
        payload: req.payload as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + TTL_HOURS * 3600_000),
      },
    });
    await this.events.emit('approval.requested', { approvalId: approval.id, kind: req.kind, summary: req.summary, tokenId: actor.tokenId }, { actor, resource: `approval:${approval.id}` });
    this.notifyOwners(approval).catch((e) => this.log.warn(`approval mail failed: ${e.message}`));
    return approval;
  }

  /** True when this actor must ask before performing `kind`. */
  needs(actor: Actor, kind: string) {
    return actor.isAgent && actor.requireApprovalFor.has(kind);
  }

  /**
   * Records the request, notifies the team and throws `approval_required` (403) with the
   * approval id in details, so every client (CLI, MCP, SDK) sees one consistent shape.
   */
  async request(actor: Actor, req: ApprovalRequest): Promise<never> {
    // Reuse an identical pending request instead of spamming owners when an agent retries.
    const existing = await this.prisma.approval.findFirst({
      where: { tokenId: actor.tokenId, kind: req.kind, resourceId: req.resourceId ?? null, status: 'pending', payload: { equals: req.payload as Prisma.InputJsonValue } },
    });
    const approval = existing ?? (await this.prisma.approval.create({
      data: {
        teamId: actor.teamId,
        projectId: req.projectId,
        tokenId: actor.tokenId,
        requestedById: actor.userId,
        kind: req.kind,
        resourceType: req.resourceType,
        resourceId: req.resourceId,
        resourceName: req.resourceName,
        summary: req.summary,
        payload: req.payload as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + TTL_HOURS * 3600_000),
      },
    }));
    if (!existing) {
      await this.events.emit('approval.requested', { approvalId: approval.id, kind: req.kind, summary: req.summary, tokenId: actor.tokenId }, { actor, resource: `approval:${approval.id}` });
      this.notifyOwners(approval).catch((e) => this.log.warn(`approval mail failed: ${e.message}`));
    }
    throw new ApiError(403, 'approval_required', `A team owner must approve this first: ${req.summary}`, {
      approvalId: approval.id,
      status: approval.status,
      expiresAt: approval.expiresAt,
      consoleUrl: `${loadConfig().CONSOLE_URL}/approvals`,
    });
  }

  list(actor: Actor, status?: string) {
    return this.prisma.approval.findMany({
      where: { teamId: actor.teamId, ...(status ? { status: status as Approval['status'] } : {}), ...(actor.isAgent ? { tokenId: actor.tokenId } : {}), ...(actor.projectId ? { projectId: actor.projectId } : {}) },
      include: { token: { select: { name: true, prefix: true } }, decidedBy: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async get(actor: Actor, id: string) {
    const a = await this.prisma.approval.findFirst({
      where: { id, teamId: actor.teamId, ...(actor.isAgent ? { tokenId: actor.tokenId } : {}), ...(actor.projectId ? { projectId: actor.projectId } : {}) },
      include: { token: { select: { name: true, prefix: true } }, decidedBy: { select: { name: true, email: true } } },
    });
    if (!a) throw ApiError.notFound('approval', id);
    return a;
  }

  async approve(actor: Actor, id: string) {
    const approval = await this.takeDecision(actor, id);
    const run = this.executors.get(approval.kind);
    if (!run) throw ApiError.invalidState(`No executor registered for ${approval.kind}`);

    // The action runs with no more than both sides hold: the approver's own scopes (a token's,
    // not the whole role), the approver's role, and what the requesting token may still do.
    const roleScopes = scopesForRole(actor.role);
    let scopes = new Set([...actor.scopes].filter((s) => roleScopes.has(s)));
    if (approval.tokenId) {
      const requester = await this.requestingTokenScopes(approval.tokenId, approval.teamId);
      scopes = new Set([...scopes].filter((s) => requester.has(s)));
    }
    const needed = requiredScope(approval.kind);
    if (!scopes.has(needed)) throw ApiError.forbidden(`Approving this needs the ${needed} scope, held by both you and the requesting token`);

    // Run as the approver, but keep the token's identity so its spend cap and project scope still apply
    // and the audit log shows both the human and the agent.
    const asToken: Actor = {
      userId: actor.userId,
      teamId: actor.teamId,
      role: actor.role,
      projectId: approval.projectId,
      scopes,
      tokenId: approval.tokenId ?? undefined,
      isAgent: true,
      requireApprovalFor: new Set(),
      locale: actor.locale,
    };
    try {
      const result = await run(asToken, approval);
      const done = await this.prisma.approval.update({
        where: { id },
        data: { status: 'approved', decidedById: actor.userId, decidedAt: new Date(), result: (result ?? {}) as Prisma.InputJsonValue },
      });
      await this.events.emit('approval.decided', { approvalId: id, decision: 'approved', kind: approval.kind, summary: approval.summary }, { actor, resource: `approval:${id}` });
      return done;
    } catch (err) {
      const message = err instanceof ApiError ? (err.getResponse() as { error: { message: string } }).error?.message ?? err.message : (err as Error).message;
      await this.prisma.approval.update({ where: { id }, data: { status: 'failed', decidedById: actor.userId, decidedAt: new Date(), reason: message } });
      await this.events.emit('approval.decided', { approvalId: id, decision: 'failed', kind: approval.kind, error: message }, { actor, resource: `approval:${id}` });
      throw err;
    }
  }

  async deny(actor: Actor, id: string, reason?: string) {
    const approval = await this.takeDecision(actor, id);
    const done = await this.prisma.approval.update({ where: { id }, data: { status: 'denied', decidedById: actor.userId, decidedAt: new Date(), reason } });
    await this.events.emit('approval.decided', { approvalId: id, decision: 'denied', kind: approval.kind, summary: approval.summary, reason }, { actor, resource: `approval:${id}` });
    const handler = this.denyHandlers.get(approval.kind);
    if (handler) await handler(actor, done, reason).catch((e) => this.log.warn(`deny handler for ${approval.kind} failed: ${(e as Error).message}`));
    return done;
  }

  /** Pending requests past their deadline become `expired`. Runs from the jobs scheduler. */
  async expire() {
    const r = await this.prisma.approval.updateMany({ where: { status: 'pending', expiresAt: { lt: new Date() } }, data: { status: 'expired', decidedAt: new Date() } });
    if (r.count) this.log.log(`${r.count} approval(s) expired`);
    return r.count;
  }

  async pendingCount(actor: Actor) {
    return this.prisma.approval.count({ where: { teamId: actor.teamId, status: 'pending' } });
  }

  private async takeDecision(actor: Actor, id: string) {
    if (actor.isAgent) throw ApiError.forbidden('Agents cannot decide approvals. A person must do this in the console or CLI.');
    if (!['owner', 'admin'].includes(actor.role)) throw ApiError.forbidden('Only team owners and admins can decide approvals');
    // A console session decides; an API token only with the explicit approvals:write scope.
    if (actor.tokenId && !actor.scopes.has('approvals:write')) throw ApiError.forbidden('Token is missing required scope(s): approvals:write. Decide approvals in the console, or use a token with that scope.');
    const approval = await this.prisma.approval.findFirst({ where: { id, teamId: actor.teamId, ...(actor.projectId ? { projectId: actor.projectId } : {}) } });
    if (!approval) throw ApiError.notFound('approval', id);
    if (approval.status !== 'pending') throw ApiError.invalidState(`This request is already ${approval.status}`);
    if (approval.expiresAt < new Date()) {
      await this.prisma.approval.update({ where: { id }, data: { status: 'expired', decidedAt: new Date() } });
      throw ApiError.invalidState('This request has expired. Ask the agent to try again.');
    }
    return approval;
  }

  /** What the token that asked may do now: its scopes within its owner's current role; none once revoked or expired. */
  private async requestingTokenScopes(tokenId: string, teamId: string): Promise<Set<string>> {
    const token = await this.prisma.apiToken.findUnique({ where: { id: tokenId }, select: { scopes: true, userId: true, teamId: true, revokedAt: true, expiresAt: true } });
    if (!token || token.teamId !== teamId || token.revokedAt || (token.expiresAt && token.expiresAt < new Date())) return new Set();
    const member = await this.prisma.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: token.userId } }, select: { role: true } });
    if (!member) return new Set();
    const roleScopes = scopesForRole(member.role);
    return new Set(token.scopes.filter((s) => roleScopes.has(s)));
  }

  private async notifyOwners(approval: Approval) {
    const [owners, token] = await Promise.all([
      this.prisma.teamMember.findMany({ where: { teamId: approval.teamId, role: { in: ['owner', 'admin'] } }, include: { user: { select: { email: true, name: true } } } }),
      approval.tokenId ? this.prisma.apiToken.findUnique({ where: { id: approval.tokenId }, select: { name: true } }) : null,
    ]);
    const url = `${loadConfig().CONSOLE_URL}/approvals`;
    const entity = await teamEntity(this.prisma, approval.teamId);
    await Promise.all(owners.map((m) => this.mail.send({
      to: m.user.email,
      entity,
      subject: `Approval needed: ${approval.summary}`,
      text: `Hi ${m.user.name},\n\n${token ? `The agent token "${token.name}"` : approval.resourceType === 'connect_run' ? `The Connect agent "${approval.resourceName ?? 'agent'}"` : 'An agent'} wants to do this:\n\n    ${approval.summary}\n\nReview it here:\n${url}\n\nThe request expires in ${TTL_HOURS} hours if nobody decides. Nothing runs until you approve.`,
    })));
  }
}

/** The scope an approved action of this kind needs ("servers:delete" itself, other kinds the area's :write). */
export function requiredScope(kind: string) {
  if (kind === 'servers:delete') return 'servers:delete';
  return `${kind.split(':')[0]}:write`;
}
