import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Invoice, Team, UsageRecord } from '@prisma/client';
import { loadConfig } from '../../config/config';
import { entityProfile } from '../../common/entities/entities';
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

/**
 * Renders an invoice as a one page PDF in the name of the company that issued it (the invoice's
 * billingEntity): its legal name, address, registration and tax numbers, tax line, payment
 * instructions and footer. DejaVu Sans covers Latin letters with accents; Helvetica is the fallback.
 */
export function renderInvoicePdf(inv: Invoice & { team: Team; records: UsageRecord[] }): Promise<Buffer> {
  return new Promise((resolve) => {
    const c = loadConfig();
    const e = entityProfile(inv.billingEntity);
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Invoice ${inv.number}`, Author: e.legalName } });
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
    // Seller: the contracting company. Unset details show a placeholder, never an invented number.
    doc.font(bold).fontSize(9).fillColor('#000').text(e.legalName, 50, 80, { width: 260 });
    doc.font(regular).fillColor('#555').text(e.address, { width: 260 });
    for (const r of e.registrations) doc.text(`${r.label}: ${r.value}`, { width: 260 });
    if (e.taxId) doc.text(`${e.taxLabel} number: ${e.taxId}`, { width: 260 });
    doc.text(e.supportEmail, { width: 260 });
    const sellerEnd = doc.y;
    doc.fillColor('#000').font(bold).fontSize(16).text(inv.eInvoiceType === 'zatca' ? 'TAX INVOICE' : 'INVOICE', 350, 50, { align: 'right' });
    doc.font(regular).fontSize(10)
      .text(`Number: ${inv.number}`, 350, 76, { align: 'right' })
      .text(`Issued: ${date(inv.createdAt)}`, { align: 'right' })
      .text(`Due: ${date(inv.dueAt)}`, { align: 'right' })
      .text(`Status: ${inv.status.toUpperCase()}${inv.paidAt ? ` (${date(inv.paidAt)})` : ''}`, { align: 'right' });
    if (inv.eInvoiceType) doc.text(`${inv.eInvoiceType}${inv.eInvoiceId ? ` ${inv.eInvoiceId}` : ''}`, { align: 'right' });

    // Bill to
    doc.moveDown(2);
    const y0 = Math.max(150, sellerEnd + 14);
    doc.font(bold).fontSize(10).text('Bill to', 50, y0);
    // Buyer details from the team profile (Team page in the console).
    doc.font(regular).text(inv.team.name, 50, y0 + 14, { width: 260 });
    if (inv.team.billingAddress) doc.text(inv.team.billingAddress, { width: 260 });
    doc.text(`Country: ${inv.team.country}`, { width: 260 });
    if (inv.team.taxId) doc.text(`${inv.billingEntity === 'progrid_arabia' ? 'VAT number' : 'Tax ID'}: ${inv.team.taxId}`, { width: 260 });
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
    let y = Math.max(y0 + 80, billToEnd + 24);
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
    if (inv.discountMinor) {
      // Partner promo code: a percentage off the usage before tax.
      total('Usage', money(inv.subtotalMinor + inv.discountMinor));
      total(`Promo code discount (${Math.round((inv.discountMinor / (inv.subtotalMinor + inv.discountMinor)) * 100)}%)`, `-${money(inv.discountMinor)}`);
    }
    total('Subtotal', money(inv.subtotalMinor));
    // The rate in force when it was issued: tax divided by the subtotal, to the nearest tenth of a percent.
    if (inv.taxMinor) total(`${e.taxLabel} (${Math.round((inv.taxMinor / Math.max(inv.subtotalMinor, 1)) * 1000) / 10}%)`, money(inv.taxMinor));
    if (inv.creditMinor) total('Credit applied', `-${money(inv.creditMinor)}`);
    if (inv.creditedMinor) {
      total('Total', money(inv.totalMinor));
      total('Credit notes', `-${money(inv.creditedMinor)}`);
      total('Total due', money(inv.totalMinor - inv.creditedMinor), true);
    } else {
      total('Total due', money(inv.totalMinor), true);
    }

    // Payment instructions
    y += 18;
    const due = inv.totalMinor - inv.creditedMinor;
    if (inv.status === 'open' && due > 0) {
      doc.font(bold).fontSize(10).fillColor('#000').text('How to pay', 50, y);
      doc.font(regular).fontSize(9).fillColor('#333').text(`Pay by card on the billing page: ${e.consoleUrl}/billing`, 50, y + 14, { width: 495 });
      if (e.bankDetails) doc.text(`Bank transfer to ${e.legalName}: ${e.bankDetails.split('|').map((l) => l.trim()).join(', ')}. Quote ${inv.number} as the reference.`, { width: 495 });
    }

    // Footer
    doc.fontSize(8).fillColor('#555').font(regular);
    const note = inv.eInvoiceType === 'zatca'
      ? `Prices exclude VAT; VAT is shown as a separate line. This is a tax invoice under the ZATCA e-invoicing regulation; the QR code and clearance are attached by our e-invoicing provider.`
      : inv.taxMinor
        ? `Prices are in ${inv.currency} and exclude tax; tax is shown as a separate line.`
        : `Prices are in ${inv.currency}. No tax is added to this invoice.`;
    // The footer flows: the ZATCA note takes two lines, the others one.
    doc.text(note, 50, 728, { width: 495, align: 'center' });
    doc.text(`Services provided by ${e.legalName} under its terms of service: ${e.termsUrl}`, 50, doc.y + 4, { width: 495, align: 'center' });
    doc.text(`${c.COMPANY_NAME} · ${e.domain ?? e.wwwUrl.replace(/^https?:\/\//, '')} · ${e.supportEmail}`, 50, doc.y + 4, { width: 495, align: 'center' });
    doc.end();
  });
}
