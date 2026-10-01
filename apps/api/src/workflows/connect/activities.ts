import type { INestApplicationContext } from '@nestjs/common';
import { RunService } from '../../modules/connect/runtime/run.service';
import { RunsService } from '../../modules/connect/runs.service';

/**
 * Activities of the Connect workflows. A run executes inside one activity (its own limits and
 * checkpoints make it resumable), so the activity is never retried by Temporal: a second
 * attempt would find the run already claimed and do nothing anyway.
 */
export interface ConnectActivities {
  connectExecuteRun(runId: string): Promise<void>;
  connectScheduledRun(agentId: string): Promise<string>;
}

export function createConnectActivities(app: INestApplicationContext): ConnectActivities {
  const run = app.get(RunService);
  const runs = app.get(RunsService);
  return {
    connectExecuteRun: (runId) => run.execute(runId),
    connectScheduledRun: (agentId) => runs.scheduled(agentId),
  };
}
