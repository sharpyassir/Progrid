/** The data a monthly report is built from (stored as MonthlyReport.data). */
export interface ReportData {
  period: string;
  periodStart: string;
  periodEnd: string;
  team: { id: string; name: string };
  plan: { code: string; name: string; coverage: string };
  calendar: string;
  assets: { id: string; name: string; kind: string; observedMinutes: number; downtimeMinutes: number; uptimePercent: number | null }[];
  /** Mean uptime over the assets with observed time, weighted by observed minutes. */
  uptimePercent: number | null;
  incidents: {
    alerts: { total: number; critical: number; warning: number; info: number };
    majorTickets: { id: string; number: number; subject: string; priority: string; openedAt: string; closedAt: string | null; source: string | null }[];
  };
  sla: { tickets: number; responseMet: number; responseBreached: number; resolveMet: number; resolveBreached: number };
  patches: { runs: number; succeeded: number; failed: number };
  backupTests: { runs: number; succeeded: number; failed: number };
  hours: { billableMinutes: number; nonBillableMinutes: number; includedMinutes: number; overageMinutes: number };
}

interface Span { from: number; to: number }

/** Total length of the union of spans, in ms. */
export function unionLength(spans: Span[]) {
  const sorted = spans.filter((s) => s.to > s.from).sort((a, b) => a.from - b.from);
  let total = 0;
  let cur: Span | null = null;
  for (const s of sorted) {
    if (!cur || s.from > cur.to) {
      if (cur) total += cur.to - cur.from;
      cur = { ...s };
    } else if (s.to > cur.to) cur.to = s.to;
  }
  if (cur) total += cur.to - cur.from;
  return total;
}

/**
 * Uptime of one asset over its observed window: 100 percent minus the time covered by CRITICAL
 * alerts (Alertmanager host alerts and missing heartbeats), overlapping alerts counted once.
 */
export function uptime(window: Span, criticalAlerts: { startsAt: Date; endsAt: Date | null }[]) {
  const observed = Math.max(0, window.to - window.from);
  if (!observed) return { observedMinutes: 0, downtimeMinutes: 0, uptimePercent: null };
  const down = unionLength(criticalAlerts.map((a) => ({ from: Math.max(window.from, a.startsAt.getTime()), to: Math.min(window.to, a.endsAt?.getTime() ?? window.to) })));
  return { observedMinutes: Math.round(observed / 60_000), downtimeMinutes: Math.round(down / 60_000), uptimePercent: Math.round((1 - down / observed) * 100_000) / 1000 };
}

/** Default recommendations; the engineer edits them before the report is sent. */
export function draftRecommendations(d: ReportData) {
  const out: string[] = [];
  const weak = d.assets.filter((a) => a.uptimePercent !== null && a.uptimePercent < 99.5);
  if (weak.length) out.push(`Review the availability of ${weak.map((a) => a.name).join(', ')}: consider a second instance behind a load balancer, or a larger size if the outages were resource related.`);
  if (d.sla.responseBreached || d.sla.resolveBreached) out.push('Some targets were missed this month. We will review the tickets with you and adjust staffing or runbooks.');
  if (d.patches.failed) out.push('A patch window failed. We will reschedule it and confirm the affected servers are fully updated.');
  if (!d.patches.runs) out.push('No patch window ran this month. Agree on a monthly window so security updates are applied on time.');
  if (!d.backupTests.runs) out.push('No backup restore test ran this month. We recommend a monthly restore test for every server with data.');
  if (d.hours.overageMinutes > 0) out.push(`Engineer time exceeded the included hours by ${Math.round((d.hours.overageMinutes / 60) * 10) / 10} hours. If this continues, a larger plan may cost less.`);
  if (!out.length) out.push('Everything ran within targets this month. No changes recommended.');
  return out.join('\n\n');
}
