import { sleep } from '@temporalio/workflow';
import { act, slow } from './proxies';

export interface MonthlyReportInput {
  contractId: string;
  /** "2026-09": the month the report covers. */
  period: string;
}

/**
 * Started on the 1st for every ACTIVE contract. Drafts last month's report (uptime, incidents,
 * SLA, patches, backup tests, hours, recommendations, PDF) so an engineer can edit the
 * recommendations and send it. If it is still a draft on MANAGED_REPORT_AUTOSEND_DAY (the 3rd,
 * 06:00 UTC) the workflow sends it to the team owners.
 */
export async function managedMonthlyReport(input: MonthlyReportInput): Promise<string> {
  const reportId = await slow.managedReportGenerate(input.contractId, input.period);
  const sendAt = await act.managedReportAutoSendAt(input.period);
  const ms = new Date(sendAt).getTime() - Date.now();
  if (ms > 0) await sleep(ms);
  return act.managedReportAutoSend(reportId);
}
