import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Invoice, Team, UsageRecord } from '@prisma/client';
import { loadConfig } from '../../config/config';
import { parseTokenResourceId } from '../connect/pricing';

/** Official logo lockup, shipped with the api package (assets/progrid-logo.png). */
const LOGO = [join(__dirname, '../../../assets/progrid-logo.png'), join(process.cwd(), 'assets/progrid-logo.png'), join(process.cwd(), 'apps/api/assets/progrid-logo.png')].find((f) => existsSync(f));
const FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf'].find(existsSync);
const FONT_BOLD = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'].find(existsSync);

const LABEL: Record<string, string> = { server: 'Servers', public_ip: 'Public IP addresses', snapshot: 'Snapshots', backup: 'Backups', managed_server: 'Managed servers', support: 'Support plan', kubernetes: 'Kubernetes control plane', app_instance: 'App Platform', volume: 'Volumes', bandwidth: 'Bandwidth', app: 'Marketplace apps', managed_plan: 'Managed cloud plan', managed_overage: 'Managed cloud engineer time beyond included hours', connect_execution: 'Connect executions', connect_tool_call: 'Connect tool calls', connect_ai_input: 'AI input tokens', connect_ai_output: 'AI output tokens', connect_ai_cache_read: 'AI cache read tokens', connect_ai_cache_write: 'AI cache write tokens', connect_ai_cache_write_1h: 'AI cache write tokens (1 hour)' };

/** Connect token rows are per model (resourceId "<agent id>:<model id>"), so their invoice lines are too. */
function lineKey(r: UsageRecord) {
  const model = r.resourceType.startsWith('connect_ai_') ? parseTokenResourceId(r.resourceId).model : null;
  return model ? `${r.resourceType}:${model}` : r.resourceType;
}

function lineLabel(key: string) {
  const i = key.indexOf(':');
  if (i < 0) return LABEL[key] ?? key;
  const type = key.slice(0, i);
  return `${LABEL[type] ?? type}, ${key.slice(i + 1)}`;
}

/** Renders an invoice as a one page PDF. DejaVu Sans covers Latin letters with accents; Helvetica is the fallback. */
export function renderInvoicePdf(inv: Invoice & { team: Team; records: UsageRecord[] }): Promise<Buffer> {
  return new Promise((resolve) => {
    const c = loadConfig();
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Invoice ${inv.number}`, Author: c.COMPANY_NAME } });
    const chunks: Buffer[] = [];
    doc.on('data', (b: Buffer) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const regular = FONT ?? 'Helvetica', bold = FONT_BOLD ?? 'Helvetica-Bold';
    const money = (m: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: inv.currency }).format(m / 100);
    const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

    // Header
    if (LOGO) {
      doc.image(LOGO, 50, 44, { height: 30 });
    } else {
      doc.font(bold).fontSize(20).text(c.COMPANY_NAME, 50, 50);
    }
    doc.font(regular).fontSize(9).fillColor('#555').text(c.COMPANY_ADDRESS, 50, 76, { width: 260 });
    if (c.COMPANY_TAX_ID) doc.text(`Tax ID: ${c.COMPANY_TAX_ID}`);
    doc.fillColor('#000').font(bold).fontSize(16).text('INVOICE', 350, 50, { align: 'right' });
    doc.font(regular).fontSize(10)
      .text(`Number: ${inv.number}`, 350, 76, { align: 'right' })
      .text(`Issued: ${date(inv.createdAt)}`, { align: 'right' })
      .text(`Due: ${date(inv.dueAt)}`, { align: 'right' })
      .text(`Status: ${inv.status.toUpperCase()}${inv.paidAt ? ` (${date(inv.paidAt)})` : ''}`, { align: 'right' });
    if (inv.eInvoiceType) doc.text(`${inv.eInvoiceType}${inv.eInvoiceId ? ` ${inv.eInvoiceId}` : ''}`, { align: 'right' });

    // Bill to
    doc.moveDown(2);
    const y0 = 140;
    doc.font(bold).fontSize(10).text('Bill to', 50, y0);
    // Buyer details from the team profile (Team page in the console).
    doc.font(regular).text(inv.team.name, 50, y0 + 14, { width: 260 });
    if (inv.team.billingAddress) doc.text(inv.team.billingAddress, { width: 260 });
    doc.text(`Country: ${inv.team.country}`, { width: 260 });
    if (inv.team.taxId) doc.text(`${inv.team.country === 'SA' ? 'VAT number' : 'Tax ID'}: ${inv.team.taxId}`, { width: 260 });
    if (inv.team.billingEmail) doc.text(inv.team.billingEmail, { width: 260 });
    const billToEnd = doc.y;
    doc.font(bold).text('Period', 350, y0, { align: 'right' });
    doc.font(regular).text(`${date(inv.periodStart)} to ${date(new Date(inv.periodEnd.getTime() - 1))}`, 350, y0 + 14, { align: 'right' });

    // Lines
    const groups = new Map<string, { qty: number; amount: number; unit: string }>();
    for (const r of inv.records) {
      const key = lineKey(r);
      const g = groups.get(key) ?? { qty: 0, amount: 0, unit: r.unit };
      g.qty += r.quantity; g.amount += r.amountMinor; groups.set(key, g);
    }
    let y = Math.max(220, billToEnd + 24);
    const col = { desc: 50, qty: 330, amount: 545 };
    doc.rect(50, y - 6, 495, 20).fill('#f1f5f9').fillColor('#000');
    doc.font(bold).fontSize(9).text('Description', col.desc + 6, y).text('Usage', col.qty, y, { width: 120, align: 'right' }).text('Amount', 400, y, { width: 145, align: 'right' });
    y += 22;
    doc.font(regular).fontSize(10);
    for (const [type, g] of groups) {
      // Metering counts minutes; people read hours.
      const usage = g.unit === 'minute' ? `${(g.qty / 60).toFixed(1)} hours` : g.unit === 'gb_minute' ? `${(g.qty / 60).toFixed(1)} GB hours` : g.unit === 'byte' ? `${(g.qty / 1e9).toFixed(2)} GB` : g.unit === 'month' ? `${Math.round(g.qty * 100) / 100} ${g.qty === 1 ? 'month' : 'months'}` : g.unit === 'hour' ? `${g.qty.toFixed(2)} hours` : `${Math.round(g.qty * 100) / 100} ${g.unit}`;
      doc.text(lineLabel(type), col.desc + 6, y).text(usage, col.qty, y, { width: 120, align: 'right' }).text(money(g.amount), 400, y, { width: 145, align: 'right' });
      y += 18;
    }
    if (groups.size === 0) { doc.fillColor('#555').text('No usage in this period', col.desc + 6, y).fillColor('#000'); y += 18; }

    // Totals
    y += 10;
    doc.moveTo(300, y).lineTo(545, y).strokeColor('#cbd5e1').stroke();
    y += 8;
    const total = (label: string, v: string, strong = false) => { doc.font(strong ? bold : regular).text(label, 300, y, { width: 150 }).text(v, 450, y, { width: 95, align: 'right' }); y += 16; };
    total('Subtotal', money(inv.subtotalMinor));
    if (inv.taxMinor) total(inv.currency === 'SAR' ? 'VAT (15%)' : 'Tax', money(inv.taxMinor));
    if (inv.creditMinor) total('Credit applied', `-${money(inv.creditMinor)}`);
    if (inv.creditedMinor) {
      total('Total', money(inv.totalMinor));
      total('Credit notes', `-${money(inv.creditedMinor)}`);
      total('Total due', money(inv.totalMinor - inv.creditedMinor), true);
    } else {
      total('Total due', money(inv.totalMinor), true);
    }

    // Footer
    doc.fontSize(8).fillColor('#555').font(regular);
    const note = inv.currency === 'SAR'
      ? 'Prices are set in Saudi riyals and exclude VAT; VAT at 15% is shown as a separate line. This is a tax invoice under the ZATCA e-invoicing regulation; the QR code and clearance are attached by our e-invoicing provider.'
      : 'Prices are set in Saudi riyals and converted to US dollars at the exchange rate stored for each hour of usage. No VAT is charged on this invoice.';
    doc.text(note, 50, 760, { width: 495, align: 'center' });
    doc.text(`${c.COMPANY_NAME} · ${c.PUBLIC_API_URL.replace(/^https?:\/\/(api\.)?/, '')}`, 50, 775, { width: 495, align: 'center' });
    doc.end();
  });
}
