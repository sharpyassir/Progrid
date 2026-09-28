import { Injectable, Logger } from '@nestjs/common';
import { TemporalService } from '../../common/temporal/temporal.service';

/**
 * Starts and signals the managed cloud workflows (apps/api/src/workflows/managed). Workflow ids
 * are deterministic so a repeated start is a no op. Callers keep working when Temporal is down:
 * every workflow re-checks the database, and the services fall back to doing the step inline.
 */
@Injectable()
export class ManagedWorkflows {
  private readonly log = new Logger(ManagedWorkflows.name);
  constructor(private readonly temporal: TemporalService) {}

  static onboardingId = (contractId: string) => `managed-onboarding-${contractId}`;
  static slaId = (ticketId: string, kind: 'response' | 'resolve', priority: string) => `managed-sla-${kind}-${ticketId}-${priority}`;
  static pageEscalationId = (pageId: string) => `managed-page-${pageId}`;
  static maintenanceId = (runId: string) => `managed-maintenance-${runId}`;
  static reportId = (contractId: string, period: string) => `managed-report-${contractId}-${period}`;

  /** Starts a workflow; true when it runs (or already ran with this id), false when Temporal refused. */
  async start(workflow: string, args: unknown[], workflowId: string): Promise<boolean> {
    try {
      await this.temporal.start(workflow, args as never, workflowId);
      return true;
    } catch (err) {
      const e = err as Error;
      if (e.name === 'WorkflowExecutionAlreadyStartedError') return true;
      this.log.warn(`could not start ${workflow} (${workflowId}): ${e.message}`);
      return false;
    }
  }

  /** Signals a workflow; false when it is not running or Temporal is unreachable. */
  async signal(workflowId: string, signal: string, ...args: unknown[]): Promise<boolean> {
    try {
      await this.temporal.signal(workflowId, signal, ...args);
      return true;
    } catch (err) {
      this.log.debug(`signal ${signal} to ${workflowId} not delivered: ${(err as Error).message}`);
      return false;
    }
  }
}
