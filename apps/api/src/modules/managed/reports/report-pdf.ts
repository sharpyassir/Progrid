import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../../../config/config';
import type { ReportData } from './report-data';

/** Same assets and look as the invoice PDF (modules/billing/invoice-pdf.ts). */
const LOGO = [join(__dirname, '../../../../assets/progrid-logo.png'), join(process.cwd(), 'assets/progrid-logo.png'), join(process.cwd(), 'apps/api/assets/progrid-logo.png')].find((f) => existsSync(f));
const FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf'].find(existsSync);
const FONT_BOLD = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'].find(existsSync);

const hours = (m: number) => `${Math.round((m / 60) * 10) / 10} h`;
const pct = (v: number | null) => (v === null ? 'n/a' : `${v.toFixed(v === 100 ? 0 : 2)}%`);

/** Renders the monthly managed cloud report as an A4 PDF. */
export function renderReportPdf(d: ReportData, recommendations: string, generatedAt: Date): Promise<Buffer> {
  return new Promise((resolve) => {
    const c = loadConfig();
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Managed cloud report ${d.period}`, Author: c.COMPANY_NAME } });
    const chunks: Buffer[] = [];
    doc.on('data', (b: Buffer) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const regular = FONT ?? 'Helvetica', bold = FONT_BOLD ?? 'Helvetica-Bold';
    const month = new Date(`${d.period}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

    // Header
    if (LOGO) doc.image(LOGO, 50, 44, { height: 30 });
    else doc.font(bold).fontSize(20).text(c.COMPANY_NAME, 50, 50);
    doc.fillColor('#000').font(bold).fontSize(16).text('MANAGED CLOUD REPORT', 300, 50, { align: 'right', width: 245 });
    doc.font(regular).fontSize(10).text(month, 300, 72, { align: 'right', width: 245 }).text(d.team.name, { align: 'right', width: 245 }).text(`${d.plan.name} plan, ${d.plan.coverage === 'TWENTY_FOUR_SEVEN' ? '24/7' : 'business hours'}`, { align: 'right', width: 245 });

    // Summary tiles
    let y = 140;
    const tiles: [string, string][] = [
      ['Uptime', pct(d.uptimePercent)],
      ['Incidents', String(d.incidents.alerts.critical)],
      ['SLA met', `${d.sla.responseMet + d.sla.resolveMet}`],
      ['SLA breached', `${d.sla.responseBreached + d.sla.resolveBreached}`],
      ['Patch runs', `${d.patches.succeeded}/${d.patches.runs}`],
      ['Hours used', `${hours(d.hours.billableMinutes)} of ${hours(d.hours.includedMinutes)}`],
    ];
    const w = 495 / 3;
    tiles.forEach(([label, value], i) => {
      const x = 50 + (i % 3) * w;
      const ty = y + Math.floor(i / 3) * 52;
      doc.rect(x + 2, ty, w - 4, 46).fill('#f1f5f9').fillColor('#555').font(regular).fontSize(8).text(label.toUpperCase(), x + 10, ty + 8, { width: w - 20 });
      doc.fillColor('#000').font(bold).fontSize(14).text(value, x + 10, ty + 20, { width: w - 20 });
    });
    y += 120;

    const section = (title: string) => {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      doc.font(bold).fontSize(11).fillColor('#000').text(title, 50, y);
      y += 18;
    };
    /** One table row; columns listed in `left` are left aligned, the rest right aligned. Cells never wrap. */
    const row = (cols: string[], widths: number[], strong = false, left: number[] = [0]) => {
      if (y > 740) {
        doc.addPage();
        y = 50;
      }
      let x = 56;
      doc.font(strong ? bold : regular).fontSize(9);
      cols.forEach((col, i) => {
        const w = widths[i] - 8;
        let text = col;
        while (text.length > 1 && doc.widthOfString(text) > w) text = text.slice(0, -2) + '…';
        doc.text(text, x, y, { width: w, align: left.includes(i) ? 'left' : 'right', lineBreak: false });
        x += widths[i];
      });
      y += 15;
    };
    const header = (cols: string[], widths: number[], left: number[] = [0]) => {
      doc.rect(50, y - 4, 495, 16).fill('#f1f5f9').fillColor('#000');
      row(cols, widths, true, left);
    };

    section('Availability per asset');
    const aw = [215, 90, 95, 95];
    header(['Asset', 'Uptime', 'Downtime', 'Observed'], aw);
    if (!d.assets.length) row(['No managed assets in this period', '', '', ''], aw);
    for (const a of d.assets) row([`${a.name} (${a.kind.toLowerCase().replace(/_/g, ' ')})`, pct(a.uptimePercent), `${a.downtimeMinutes} min`, hours(a.observedMinutes)], aw);
    y += 10;

    section('Incidents');
    doc.font(regular).fontSize(9).text(`${d.incidents.alerts.total} alerts: ${d.incidents.alerts.critical} critical, ${d.incidents.alerts.warning} warnings, ${d.incidents.alerts.info} informational.`, 56, y);
    y += 16;
    const iw = [55, 215, 55, 85, 85];
    const when = (iso: string) => iso.slice(5, 16).replace('T', ' ');
    if (d.incidents.majorTickets.length) {
      header(['Ticket', 'Subject', 'Priority', 'Opened', 'Resolved'], iw, [0, 1]);
      for (const t of d.incidents.majorTickets) row([`#${t.number}`, t.subject, t.priority, when(t.openedAt), t.closedAt ? when(t.closedAt) : 'open'], iw, false, [0, 1]);
    } else {
      doc.text('No P1 or P2 tickets this month.', 56, y);
      y += 15;
    }
    y += 10;

    section('Service levels');
    const sw = [215, 140, 140];
    header(['Target', 'Met', 'Breached'], sw);
    row(['First response', String(d.sla.responseMet), String(d.sla.responseBreached)], sw);
    row(['Resolution', String(d.sla.resolveMet), String(d.sla.resolveBreached)], sw);
    y += 10;

    section('Maintenance and engineer time');
    header(['Item', 'Runs', 'Succeeded', 'Failed'], aw);
    row(['Patch windows', String(d.patches.runs), String(d.patches.succeeded), String(d.patches.failed)], aw);
    row(['Backup restore tests', String(d.backupTests.runs), String(d.backupTests.succeeded), String(d.backupTests.failed)], aw);
    y += 6;
    doc.font(regular).fontSize(9).text(`Engineer time: ${hours(d.hours.billableMinutes)} billable and ${hours(d.hours.nonBillableMinutes)} not billable, against ${hours(d.hours.includedMinutes)} included.${d.hours.overageMinutes ? ` ${hours(d.hours.overageMinutes)} beyond the included time is billed on your invoice.` : ''}`, 56, y, { width: 489 });
    y = doc.y + 16;

    section('Recommendations');
    doc.font(regular).fontSize(10).text(recommendations || 'None this month.', 56, y, { width: 489 });
    // Keep the footer clear of long recommendations.
    if (doc.y > 735) doc.addPage();

    // Footer
    doc.fontSize(7.5).fillColor('#555').font(regular);
    doc.text('Uptime is the share of each asset\'s observed time in the month (from approval or the start of the month, to removal or the end of the month) not covered by a critical alert, including missing heartbeats. Overlapping alerts count once. Times are UTC.', 50, 755, { width: 495, align: 'center' });
    doc.text(`${c.COMPANY_NAME} · generated ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`, 50, 780, { width: 495, align: 'center' });
    doc.end();
  });
}
