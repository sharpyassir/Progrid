import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client, Connection, WorkflowStartOptions } from '@temporalio/client';
import { loadConfig } from '../../config/config';

/** Temporal client used by the API to start lifecycle workflows. */
@Injectable()
export class TemporalService implements OnModuleInit {
  private readonly log = new Logger(TemporalService.name);
  private client?: Client;
  readonly taskQueue = loadConfig().TEMPORAL_TASK_QUEUE;

  async onModuleInit() {
    await this.connect().catch((err) => this.log.warn(`Temporal unavailable (${(err as Error).message}); will retry on first use`));
  }

  /** Connects (or reconnects) on demand so an API that booted before Temporal still recovers. */
  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const { TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE } = loadConfig();
    const connection = await Connection.connect({ address: TEMPORAL_ADDRESS, connectTimeout: 3000 });
    this.client = new Client({ connection, namespace: TEMPORAL_NAMESPACE });
    this.log.log(`connected to Temporal at ${TEMPORAL_ADDRESS}`);
    return this.client;
  }

  /**
   * Starts a workflow. `workflowId` must be `<operation>-<resourceId>` so a duplicate
   * request cannot start the same operation twice.
   */
  async start<T extends (...args: any[]) => any>(
    workflow: string,
    args: Parameters<T>,
    workflowId: string,
    opts: Partial<WorkflowStartOptions> = {},
  ) {
    const startOnce = async () => {
      const client = await this.connect();
      const handle = await client.workflow.start(workflow, { taskQueue: this.taskQueue, workflowId, args, ...opts });
      return handle.workflowId;
    };
    try {
      return await startOnce();
    } catch (err) {
      // A client bound to a Temporal server that has since restarted fails here; reconnect once.
      this.log.warn(`workflow start failed (${(err as Error).message}); reconnecting to Temporal and retrying`);
      this.client = undefined;
      return startOnce();
    }
  }

  async signal(workflowId: string, signal: string, ...args: unknown[]) {
    const client = await this.connect();
    await client.workflow.getHandle(workflowId).signal(signal, ...args);
  }

  /** Stops a workflow (e.g. a cron schedule). A workflow that is not running is fine. */
  async terminate(workflowId: string, reason: string) {
    const client = await this.connect();
    await client.workflow.getHandle(workflowId).terminate(reason).catch((err: Error & { name?: string }) => {
      if (err.name !== 'WorkflowNotFoundError') throw err;
    });
  }
}
