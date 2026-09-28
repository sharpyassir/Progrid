import type { Alert, ManagedAsset, ManagedContract, ManagedPlan, MaintenanceRun, MaintenanceTask, Page, Responsibility, Ticket, TicketMessage } from '@prisma/client';

/**
 * Explicit mappers for everything /ops/v1 returns. Nothing is spread from a database row, so a
 * new column never leaks by accident. Rules (docs/devops-console.md, "Data masking"):
 *   - no email address or phone number of anyone, customer or staff; people appear by id and name;
 *   - no billing, pricing or invoice fields of a contract or team;
 *   - text the customer wrote (ticket subjects and customer messages) has email addresses and
 *     phone numbers masked for external engineers, because customer replies go through tickets.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** International or long local numbers: digits with optional spaces or dashes, never dots (IP addresses, versions). */
const PHONE = /(?<![\w.:/])(?:\+|00)?\d(?:[ -]?\d){8,14}(?![\w.:/])/g;

export function maskContact(text: string): string {
  return text.replace(EMAIL, '[email hidden]').replace(PHONE, '[phone hidden]');
}

type Person = { id: string; name: string } | null | undefined;
export const person = (p: Person) => (p ? { id: p.id, name: p.name } : null);

export function opsContract(c: ManagedContract & { plan: Pick<ManagedPlan, 'code' | 'name' | 'coverage'>; team: { name: string } }) {
  return {
    id: c.id,
    customer: c.team.name,
    status: c.status,
    plan: { code: c.plan.code, name: c.plan.name, coverage: c.plan.coverage },
    calendar: c.calendar,
    timeZone: c.calendar === 'TR' ? 'Europe/Istanbul' : 'Asia/Riyadh',
    accessPolicy: c.accessPolicy,
    activatedAt: c.activatedAt,
  };
}

export function opsAsset(a: ManagedAsset) {
  return {
    id: a.id,
    contractId: a.contractId,
    kind: a.kind,
    name: a.name,
    address: a.address,
    managementAddress: a.managementAddress,
    provider: a.provider,
    os: a.os,
    status: a.status,
    health: a.health,
    monitoringEnabled: a.monitoringEnabled,
    backupEnabled: a.backupEnabled,
    lastHeartbeatAt: a.lastHeartbeatAt,
    heartbeat: heartbeatSummary(a.heartbeatReport),
    notes: a.notes,
  };
}

/** Only the health fields of the agent report; the rest is free form. */
function heartbeatSummary(report: unknown) {
  if (!report || typeof report !== 'object') return null;
  const r = report as Record<string, unknown>;
  return { status: typeof r.status === 'string' ? r.status : null, hostname: typeof r.hostname === 'string' ? r.hostname : null, uptimeSeconds: typeof r.uptimeSeconds === 'number' ? r.uptimeSeconds : null };
}

/** Customer facing status mapping lives in the managed module; engineers see the real status. */
export function opsTicketSummary(t: Ticket & { assignee?: Person; asset?: { id: string; name: string } | null }, external: boolean, now = new Date()) {
  const due = t.firstRespondedAt ? t.resolveDueAt : t.responseDueAt;
  return {
    id: t.id,
    number: t.number,
    subject: external ? maskContact(t.subject) : t.subject,
    status: t.status,
    priority: t.managedPriority,
    contractId: t.contractId,
    assetId: t.assetId,
    asset: t.asset ? { id: t.asset.id, name: t.asset.name } : undefined,
    assigneeId: t.assigneeId,
    assignee: t.assignee !== undefined ? person(t.assignee) : undefined,
    source: t.source,
    responseDueAt: t.responseDueAt,
    resolveDueAt: t.resolveDueAt,
    firstRespondedAt: t.firstRespondedAt,
    closedAt: t.closedAt,
    warnedAt: t.warnedAt,
    breachedAt: t.breachedAt,
    responseBreached: t.responseBreached,
    resolveBreached: t.resolveBreached,
    /** Seconds until the next SLA target (response until the first reply, then resolve); negative when late, null when closed. */
    slaSecondsLeft: t.status === 'closed' || !due ? null : Math.round((due.getTime() - now.getTime()) / 1000),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export function opsMessage(m: TicketMessage, external: boolean) {
  const customerText = !m.fromSupport;
  return {
    id: m.id,
    fromSupport: m.fromSupport,
    internal: m.internal,
    rootCause: m.rootCause,
    authorId: m.fromSupport ? m.authorId : null,
    author: m.authorName,
    body: external && customerText ? maskContact(m.body) : m.body,
    createdAt: m.createdAt,
  };
}

export function opsAlert(a: Alert & { asset?: { id: string; name: string } | null }) {
  return {
    id: a.id,
    assetId: a.assetId,
    asset: a.asset ? { id: a.asset.id, name: a.asset.name } : undefined,
    contractId: a.contractId,
    name: a.name,
    summary: a.summary,
    severity: a.severity,
    status: a.status,
    source: a.source,
    labels: a.labels,
    annotations: a.annotations,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    ticketId: a.ticketId,
    acknowledgedById: a.acknowledgedById,
    acknowledgedAt: a.acknowledgedAt,
    resolvedAt: a.resolvedAt,
  };
}

export function opsPage(p: Page) {
  return { id: p.id, alertId: p.alertId, ticketId: p.ticketId, urgency: p.urgency, channel: p.channel, message: p.message, sentAt: p.sentAt, ackAt: p.ackAt, escalatedAt: p.escalatedAt, createdAt: p.createdAt };
}

export function opsTask(t: MaintenanceTask & { asset?: { id: string; name: string } | null }) {
  return { id: t.id, contractId: t.contractId, assetId: t.assetId, asset: t.asset ? { id: t.asset.id, name: t.asset.name } : null, kind: t.kind, name: t.name, cron: t.cron, timezone: t.timezone, playbook: t.playbook, enabled: t.enabled, lastRunAt: t.lastRunAt, nextRunAt: t.nextRunAt };
}

export function opsRun(r: MaintenanceRun & { task?: { id: string; name: string; kind: string; contractId: string; assetId: string | null } }, withLog = false) {
  return {
    id: r.id, taskId: r.taskId, task: r.task ? { id: r.task.id, name: r.task.name, kind: r.task.kind, contractId: r.task.contractId, assetId: r.task.assetId } : undefined,
    status: r.status, trigger: r.trigger, runner: r.runner, startedById: r.startedById, startedAt: r.startedAt, finishedAt: r.finishedAt, error: r.error, ticketId: r.ticketId, createdAt: r.createdAt,
    ...(withLog ? { log: r.log } : {}),
  };
}

export function opsResponsibility(r: Responsibility) {
  return { id: r.id, area: r.area, owner: r.owner, notes: r.notes };
}
