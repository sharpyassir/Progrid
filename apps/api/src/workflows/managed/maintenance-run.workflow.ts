import { ApplicationFailure } from '@temporalio/workflow';
import { act, slow } from './proxies';

export interface MaintenanceRunInput {
  runId: string;
}

/**
 * One maintenance run: executes the task's playbook through the configured MaintenanceRunner
 * (fake or Ansible over the management network) and stores the status and log. A failed run
 * opens a P3 ticket assigned to the current on call engineer.
 */
export async function managedMaintenanceRun(input: MaintenanceRunInput): Promise<string> {
  let status: 'SUCCEEDED' | 'FAILED';
  try {
    status = await slow.managedMaintenanceExecute(input.runId);
  } catch (err) {
    const message = err instanceof ApplicationFailure ? err.message : err instanceof Error ? err.message : String(err);
    await act.managedMaintenanceMarkFailed(input.runId, message);
    status = 'FAILED';
  }
  if (status === 'FAILED') await act.managedMaintenanceFailureTicket(input.runId);
  return status;
}
