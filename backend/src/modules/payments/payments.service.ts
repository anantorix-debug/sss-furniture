import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export type PaymentSource = 'CUSTOMER_ORDER' | 'PARTY_ORDER' | 'SUPPLIER' | 'CARPENTER';

export interface UnifiedPayment {
  id: string;
  source: PaymentSource;
  date: Date;
  amount: number;
  mode: string | null;
  note: string | null;
  relatedName: string;
  relatedId: string;
  direction: 'IN' | 'OUT';
}

const SOURCE_LABEL: Record<PaymentSource, string> = {
  CUSTOMER_ORDER: 'Customer Order',
  PARTY_ORDER: 'Party Order',
  SUPPLIER: 'Supplier',
  CARPENTER: 'Carpenter',
};

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private pdf: PdfService,
  ) {}

  async findAll(params: { source?: PaymentSource; from?: string; to?: string; search?: string }) {
    const dateFilter =
      params.from || params.to
        ? { gte: params.from ? new Date(params.from) : undefined, lte: params.to ? new Date(params.to) : undefined }
        : undefined;

    const [customerPayments, partyPayments, supplierPayments, carpenterPayments] = await Promise.all([
      !params.source || params.source === 'CUSTOMER_ORDER'
        ? this.prisma.customerOrderPayment.findMany({
            where: { date: dateFilter },
            include: { order: { select: { id: true, orderId: true, customerName: true } } },
          })
        : [],
      !params.source || params.source === 'PARTY_ORDER'
        ? this.prisma.partyOrderPayment.findMany({
            where: { date: dateFilter },
            include: { order: { select: { id: true, shopName: true } } },
          })
        : [],
      !params.source || params.source === 'SUPPLIER'
        ? this.prisma.supplierPayment.findMany({ where: { date: dateFilter }, include: { supplier: { select: { id: true, name: true } } } })
        : [],
      !params.source || params.source === 'CARPENTER'
        ? this.prisma.carpenterPayment.findMany({ where: { date: dateFilter }, include: { carpenter: { select: { id: true, name: true } } } })
        : [],
    ]);

    const unified: UnifiedPayment[] = [
      ...customerPayments.map((p) => ({
        id: p.id,
        source: 'CUSTOMER_ORDER' as const,
        date: p.date,
        amount: Number(p.amount),
        mode: p.mode,
        note: p.note ?? `Order ${p.order.orderId}`,
        relatedName: p.order.customerName,
        relatedId: p.order.id,
        direction: 'IN' as const,
      })),
      ...partyPayments.map((p) => ({
        id: p.id,
        source: 'PARTY_ORDER' as const,
        date: p.date,
        amount: Number(p.amount),
        mode: p.mode,
        note: p.note,
        relatedName: p.order.shopName,
        relatedId: p.order.id,
        direction: 'IN' as const,
      })),
      ...supplierPayments.map((p) => ({
        id: p.id,
        source: 'SUPPLIER' as const,
        date: p.date,
        amount: Number(p.amount),
        mode: p.mode,
        note: p.particulars,
        relatedName: p.supplier.name,
        relatedId: p.supplier.id,
        direction: 'OUT' as const,
      })),
      ...carpenterPayments.map((p) => ({
        id: p.id,
        source: 'CARPENTER' as const,
        date: p.date,
        amount: Number(p.amount),
        mode: p.mode,
        note: p.note,
        relatedName: p.carpenter.name,
        relatedId: p.carpenter.id,
        direction: 'OUT' as const,
      })),
    ];

    const filtered = params.search
      ? unified.filter((p) => p.relatedName.toLowerCase().includes(params.search!.toLowerCase()))
      : unified;

    filtered.sort((a, b) => b.date.getTime() - a.date.getTime());

    const totalIn = filtered.filter((p) => p.direction === 'IN').reduce((s, p) => s + p.amount, 0);
    const totalOut = filtered.filter((p) => p.direction === 'OUT').reduce((s, p) => s + p.amount, 0);

    return { payments: filtered, totalIn, totalOut, net: totalIn - totalOut };
  }

  private buildPdfHtml(result: Awaited<ReturnType<PaymentsService['findAll']>>, params: { source?: PaymentSource; from?: string; to?: string; search?: string }): string {
    const rows = result.payments
      .map(
        (p) => `<tr>
          <td>${p.date.toLocaleDateString('en-IN')}</td>
          <td>${escapeHtml(SOURCE_LABEL[p.source])}</td>
          <td>${escapeHtml(p.relatedName)}</td>
          <td>${p.direction === 'IN' ? 'In' : 'Out'}</td>
          <td style="text-align:right">₹${p.amount.toLocaleString('en-IN')}</td>
          <td>${p.mode ? escapeHtml(p.mode) : '-'}</td>
          <td>${p.note ? escapeHtml(p.note) : '-'}</td>
        </tr>`,
      )
      .join('');

    const filterParts = [
      params.source ? SOURCE_LABEL[params.source] : null,
      params.search ? `Search: "${params.search}"` : null,
      params.from ? `From ${new Date(params.from).toLocaleDateString('en-IN')}` : null,
      params.to ? `To ${new Date(params.to).toLocaleDateString('en-IN')}` : null,
    ].filter(Boolean);

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2933; margin: 0; }
  .header { background: #80011f; color: #fff; padding: 24px 28px; }
  .header h1 { margin: 0; font-size: 20px; }
  .header p { margin: 4px 0 0; font-size: 12px; color: #f5c2c9; }
  .body { padding: 24px 28px; }
  .summary { display: flex; gap: 20px; margin-bottom: 18px; }
  .summary div { flex: 1; border: 1px solid #e3e1d9; border-radius: 8px; padding: 10px 14px; }
  .summary .label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; }
  .summary .value { font-size: 16px; font-weight: bold; margin-top: 2px; }
  .filters { font-size: 11.5px; color: #6b7280; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th { background: #f4f2ec; text-align: left; padding: 7px 9px; border-bottom: 1px solid #e3e1d9; }
  td { padding: 7px 9px; border-bottom: 1px solid #efede6; }
  .generated { margin-top: 18px; font-size: 10.5px; color: #9ca3af; }
</style></head>
<body>
  <div class="header">
    <h1>Payments Statement</h1>
    <p>SSS Company</p>
  </div>
  <div class="body">
    ${filterParts.length ? `<div class="filters"><strong>Filters:</strong> ${filterParts.map((f) => escapeHtml(f as string)).join(' &middot; ')}</div>` : ''}
    <div class="summary">
      <div><div class="label">Money In</div><div class="value" style="color:#15803d">₹${result.totalIn.toLocaleString('en-IN')}</div></div>
      <div><div class="label">Money Out</div><div class="value" style="color:#b91c1c">₹${result.totalOut.toLocaleString('en-IN')}</div></div>
      <div><div class="label">Net</div><div class="value">₹${result.net.toLocaleString('en-IN')}</div></div>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Source</th><th>Party</th><th>Direction</th><th style="text-align:right">Amount</th><th>Mode</th><th>Note</th></tr></thead>
      <tbody>
        ${rows || '<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:16px">No payments found</td></tr>'}
      </tbody>
    </table>
    <div class="generated">Generated ${new Date().toLocaleString('en-IN')} - ${result.payments.length} payment(s)</div>
  </div>
</body></html>`;
  }

  async generatePdf(params: { source?: PaymentSource; from?: string; to?: string; search?: string }): Promise<Buffer> {
    const result = await this.findAll(params);
    const html = this.buildPdfHtml(result, params);
    return this.pdf.renderHtmlToPdf(html);
  }
}
