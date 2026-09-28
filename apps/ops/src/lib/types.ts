/** Shapes of the /ops/v1 answers the console reads (apps/api/src/modules/ops, docs/devops-console.md). */

export type Priority = 'P1' | 'P2' | 'P3' | 'P4';
export type TicketStatus = 'open' | 'answered' | 'closed' | 'resolved_pending_pm';
export interface Ref { id: string; name: string }
export interface TicketRef { id: string; number: number }

export interface Contract {
  id: string; customer: string; status: string;
  plan: { code: string; name: string; coverage: string };
  calendar: string; timeZone: string; accessPolicy: string; activatedAt: string | null;
}

export interface Shift { id: string; role: 'PRIMARY' | 'SECONDARY'; startsAt: string; endsAt: string; startedAt: string | null; endedAt: string | null; state?: 'ended' | 'started' | 'missed' | 'scheduled'; handoverId?: string | null }

export interface Page { id: string; alertId: string | null; ticketId: string | null; urgency: string; channel: string; message: string; sentAt: string | null; ackAt: string | null; escalatedAt: string | null; createdAt: string }

export interface Timer {
  id: string; contractId: string | null; ticketId: string | null; ticket?: TicketRef; maintenanceRunId: string | null; note: string | null;
  startedAt: string; lastActivityAt: string; promptedAt: string | null; stoppedAt: string | null; stopReason: string | null; workLogId: string | null; elapsedSeconds: number;
}

export type GrantStatus = 'REQUESTED' | 'APPROVED' | 'ACTIVE' | 'DENIED' | 'EXPIRED' | 'REVOKED';
export interface Grant {
  id: string; contractId: string; assetId: string; asset?: Ref; ticketId: string | null; ticket: TicketRef | null; maintenanceRunId: string | null;
  reason: string; requestedMinutes: number; grantedMinutes: number | null; status: GrantStatus; auto: boolean; emergency: boolean;
  approvedById: string | null; approvedAt: string | null; denyReason: string | null; startsAt: string | null; expiresAt: string | null; secondsLeft: number | null;
  extensions: number; extendedAt: string | null; extensionReason: string | null; revokedAt: string | null; revokeReason: string | null; createdAt: string;
}

export interface HandoverTicket { id: string; number: number; subject: string; priority: Priority | null; status: string; contractId: string | null }
export interface Handover {
  id: string; shiftId: string; author: { id: string; name?: string }; shiftEndedAt?: string | null;
  openTickets: HandoverTicket[]; risks: string; pendingMaintenance: string; notes: string; createdAt: string; read?: boolean;
}

export interface Me {
  user: { id: string; name: string; locale: string };
  engineer: { kind: 'EXTERNAL' | 'INTERNAL'; country: string; timezone: string; status: string; currency: string | null };
  lead: boolean;
  contracts: Contract[];
  currentShift: Shift | null;
  openPages: Page[];
  runningTimer: Timer | null;
  activeGrants: Grant[];
  lastHandover: Handover | null;
}

export interface Ticket {
  id: string; number: number; subject: string; status: TicketStatus; priority: Priority | null; contractId: string | null; assetId: string | null; asset?: Ref;
  assigneeId: string | null; assignee?: Ref | null; source: string; responseDueAt: string | null; resolveDueAt: string | null; firstRespondedAt: string | null;
  closedAt: string | null; responseBreached: boolean; resolveBreached: boolean; slaSecondsLeft: number | null; createdAt: string; updatedAt: string;
}

export interface Message { id: string; fromSupport: boolean; internal: boolean; rootCause: boolean; authorId: string | null; author: string | null; body: string; createdAt: string }

export type Severity = 'CRITICAL' | 'WARNING' | 'INFO';
export interface Alert {
  id: string; assetId: string | null; asset?: Ref; contractId: string; name: string; summary: string | null; severity: Severity; status: 'FIRING' | 'ACKNOWLEDGED' | 'RESOLVED';
  source: string; startsAt: string; endsAt: string | null; ticketId: string | null; acknowledgedById: string | null; acknowledgedAt: string | null; resolvedAt: string | null;
}

export interface Asset {
  id: string; contractId: string; kind: 'PLATFORM_SERVER' | 'EXTERNAL_SERVER' | 'SITE'; name: string; address: string | null; managementAddress: string | null;
  provider: string | null; os: string | null; status: string; health: 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'; monitoringEnabled: boolean; backupEnabled: boolean;
  lastHeartbeatAt: string | null; heartbeat: { status: string | null; hostname: string | null; uptimeSeconds: number | null } | null; notes: string | null;
}

export interface Run {
  id: string; taskId: string; task?: { id: string; name: string; kind: string; contractId: string; assetId: string | null };
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'; trigger: string; runner: string | null; startedById: string | null;
  startedAt: string | null; finishedAt: string | null; error: string | null; ticketId: string | null; createdAt: string; log?: string;
}

export interface Task { id: string; contractId: string; assetId: string | null; asset: Ref | null; kind: string; name: string; cron: string; timezone: string; playbook: string; enabled: boolean; lastRunAt: string | null; nextRunAt: string | null }

export interface AssetCard { asset: Asset; links: { metrics: string; logs: string } | null; recentAlerts: Alert[]; lastPatch: Run | null; lastBackupTest: Run | null }

export interface AssetView extends AssetCard {
  maintenanceHistory: Run[];
  backups: { enabled: boolean; tests: Run[] };
  openTickets: Ticket[];
  responsibilities: { id: string; area: string; owner: 'PROGRID' | 'CUSTOMER' | 'SHARED'; notes: string | null }[];
}

export interface Workspace {
  ticket: Ticket;
  messages: Message[];
  sla: { responseDueAt: string | null; resolveDueAt: string | null; firstRespondedAt: string | null; responseBreached: boolean; resolveBreached: boolean };
  asset: AssetCard | null;
  alerts: Alert[];
  workLogs: { id: string; user: Ref | null; minutes: number; billable: boolean; note: string | null; workedAt: string }[];
  escalation: { suggested: boolean; afterMinutes: number };
  timer: Timer | null;
  grants: Grant[];
  suggestedRunbooks: { id: string; slug: string; title: string; tags: string[]; score: number; reasons: string[] }[];
  postmortem: { id: string; status: string; dueAt: string } | null;
}

export type WorkLogStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID';
export interface Entry {
  id: string; contractId: string; customer: string; ticketId: string | null; ticket: TicketRef | null; maintenanceRunId: string | null;
  minutes: number; sessionMinutes: number | null; billable: boolean; note: string | null; status: WorkLogStatus; source: 'TIMER' | 'MANUAL'; flagged: boolean; reason: string | null;
  workedAt: string; startedAt: string | null; endedAt: string | null; submittedAt: string | null; reviewedAt: string | null; reviewComment: string | null; createdAt: string;
}
export interface Timesheet { period: string; from: string; to: string; entries: Entry[]; totals: { minutes: number; byStatus: Partial<Record<WorkLogStatus, number>> }; runningTimer: Timer | null }

export interface Payout {
  id: string; period: string; currency: string; hourlyRateMinor: number; standbyFeeMinor: number; nightMultiplier: number; standbyShifts: number; standbyMinor: number;
  workedMinutes: number; nightMinutes: number; workMinor: number; totalMinor: number; status: 'DRAFT' | 'ISSUED' | 'PAID'; issuedAt: string | null; paidAt: string | null; paidReference: string | null; hasStatement: boolean; generatedAt: string;
  lines: { workLogs?: { customer: string; ticketNumber: number | null; maintenanceRunId: string | null; startedAt: string; minutes: number; nightMinutes: number; amountMinor: number }[]; shifts?: { startsAt: string; endsAt: string; role: string }[] } | null;
}

export interface Runbook { id: string; slug: string; title: string; tags: string[]; body?: string; excerpt?: string; updatedBy?: Ref; createdAt: string; updatedAt: string }

export type PostmortemSection = 'timeline' | 'impact' | 'rootCause' | 'fix' | 'prevention';
export interface Postmortem extends Record<PostmortemSection, string | null> {
  id: string; ticketId: string; ticket: { id: string; number: number; subject: string; status: string; resolvedAt: string | null }; contractId: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'CLOSED'; dueAt: string; overdue: boolean; submittedAt: string | null; closedAt: string | null; closeComment: string | null; createdAt: string; updatedAt: string;
}

export interface TerminalOpen {
  sessionId: string; token: string; tokenExpiresAt: string; gatewayUrl: string; asset: Ref; ticket: TicketRef | null;
  grant: { id: string; expiresAt: string }; recorded: boolean; policy: { clipboardPaste: boolean; fileDownload: boolean };
}

export interface SignInAnswer {
  session: string; expiresAt: string;
  user: { id: string; name: string; locale?: string };
  engineer: { kind: 'EXTERNAL' | 'INTERNAL'; country: string; timezone: string };
}
