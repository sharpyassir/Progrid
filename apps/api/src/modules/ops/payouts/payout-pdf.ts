import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../../../config/config';

/** Same assets and look as the invoice PDF (modules/billing/invoice-pdf.ts) and the managed report. */
const LOGO = [join(__dirname, '../../../../assets/progrid-logo.png'), join(process.cwd(), 'assets/progrid-logo.png'), join(process.cwd(), 'apps/api/assets/progrid-logo.png')].find((f) => existsSync(f));
const FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf'].find(existsSync);
const FONT_BOLD = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'].find(existsSync);

export interface StatementData {
  id: string;
  period: string;
  engineer: { name: string; country: string };
  currency: string;
  hourlyRateMinor: number;
  standbyFeeMinor: number;
  nightMultiplier: number;
  lines: { customer: string; ticket: string; startedAt: string; minutes: number; nightMinutes: number; amountMinor: number }[];
  shifts: { startsAt: string; endsAt: string; role: string }[];
  standbyMinor: number;
  workedMinutes: number;
  nightMinutes: number;
  workMinor: number;
  totalMinor: number;
  status: string;
  paidReference?: string | null;
}

const money = (minor: number, currency: string) => `${currency} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hours = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

/** Renders the monthly contractor statement as an A4 PDF. */
export function renderPayoutPdf(d: StatementData, generatedAt: Date): Promise<Buffer> {
  return new Promise((resolve) => {
    const c = loadConfig();
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Contractor statement ${d.period}`, Author: c.COMPANY_NAME } });
    const chunks: Buffer[] = [];
    doc.on('data', (b: Buffer) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const regular = FONT ?? 'Helvetica', bold = FONT_BOLD ?? 'Helvetica-Bold';
    const month = new Date(`${d.period}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

    if (LOGO) doc.image(LOGO, 50, 44, { height: 30 });
    else doc.font(bold).fontSize(20).text(c.COMPANY_NAME, 50, 50);
    doc.fillColor('#000').font(bold).fontSize(16).text('CONTRACTOR STATEMENT', 300, 50, { align: 'right', width: 245 });
    doc.font(regular).fontSize(10).text(month, 300, 72, { align: 'right', width: 245 }).text(`Statement ${d.id}`, { align: 'right', width: 245 }).text(d.status === 'PAID' ? `Paid, reference ${d.paidReference ?? ''}` : 'Not paid yet', { align: 'right', width: 245 });

    doc.font(bold).fontSize(10).text('Engineer', 50, 120).font(regular).text(`${d.engineer.name} (${d.engineer.country})`);
    doc.font(bold).text('Rates', 300, 120).font(regular).text(`${money(d.hourlyRateMinor, d.currency)} per hour, night x${d.nightMultiplier}`, 300).text(`${money(d.standbyFeeMinor, d.currency)} per completed shift`, 300);

    let y = 190;
    const row = (cols: string[], widths: number[], strong = false) => {
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
        doc.text(text, x, y, { width: w, align: i < 3 ? 'left' : 'right', lineBreak: false });
        x += widths[i];
      });
      y += 15;
    };
    const header = (cols: string[], widths: number[]) => {
      doc.rect(50, y - 4, 495, 16).fill('#f1f5f9').fillColor('#000');
      row(cols, widths, true);
    };

    doc.font(bold).fontSize(11).text('Approved work', 50, y);
    y += 18;
    const w = [125, 70, 100, 60, 60, 80];
    header(['Customer', 'Ticket', 'Started (UTC)', 'Time', 'Night', 'Amount'], w);
    if (!d.lines.length) row(['No approved work this month', '', '', '', '', ''], w);
    for (const l of d.lines) row([l.customer, l.ticket, l.startedAt.slice(0, 16).replace('T', ' '), hours(l.minutes), hours(l.nightMinutes), money(l.amountMinor, d.currency)], w);
    y += 10;

    doc.font(bold).fontSize(11).text('Standby', 50, y);
    y += 18;
    const sw = [185, 180, 130];
    header(['Shift start (UTC)', 'Shift end (UTC)', 'Role'], sw);
    if (!d.shifts.length) row(['No completed shifts this month', '', ''], sw);
    for (const s of d.shifts) row([s.startsAt.slice(0, 16).replace('T', ' '), s.endsAt.slice(0, 16).replace('T', ' '), s.role], sw);
    y += 14;

    const totals: [string, string][] = [
      [`Work: ${hours(d.workedMinutes)}, of which ${hours(d.nightMinutes)} at night`, money(d.workMinor, d.currency)],
      [`Standby: ${d.shifts.length} completed shifts`, money(d.standbyMinor, d.currency)],
    ];
    doc.font(regular).fontSize(10);
    for (const [label, value] of totals) {
      doc.text(label, 300, y, { width: 160 }).text(value, 460, y, { width: 85, align: 'right' });
      y += 16;
    }
    doc.moveTo(300, y).lineTo(545, y).stroke();
    y += 6;
    doc.font(bold).fontSize(12).text('Total', 300, y, { width: 160 }).text(money(d.totalMinor, d.currency), 430, y, { width: 115, align: 'right' });

    doc.fontSize(7.5).fillColor('#555').font(regular);
    doc.text('Only work approved by a support lead is paid. Night work is 22:00 to 06:00 in the customer contract\'s local time. Paid by bank transfer outside the platform.', 50, 755, { width: 495, align: 'center' });
    doc.text(`${c.COMPANY_NAME} · generated ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`, 50, 780, { width: 495, align: 'center' });
    doc.end();
  });
}
