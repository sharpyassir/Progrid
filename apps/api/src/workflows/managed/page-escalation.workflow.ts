import { sleep } from '@temporalio/workflow';
import { act } from './proxies';

export interface PageEscalationInput {
  pageId: string;
}

/**
 * Started for every high urgency page to the on call engineer. Waits PAGE_ACK_TIMEOUT_SECONDS
 * (ten minutes by default) and pages the support lead when the page is still unacknowledged.
 */
export async function managedPageEscalation(input: PageEscalationInput): Promise<string> {
  const seconds = await act.managedPageAckTimeout();
  await sleep(seconds * 1000);
  return act.managedEscalatePage(input.pageId);
}
