import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { AuditService } from '../audit/audit.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';
import { paginate, toSkipTake } from '../../common/utils/pagination.util';
import { escapeHtml, REPORT_PDF_STYLES, renderReportHeader, renderFilterSummary, renderGeneratedFooter } from '../../common/utils/pdf-report.util';
import { Role } from '../../common/enums/role.enum';

@Injectable()
export class SuppliersService {
  constructor(
    private prisma: PrismaService,
    private pdf: PdfService,
    private audit: AuditService,
  ) {}

  // Opt-in pagination - see the identical note on CustomerOrdersService.findAll.
  // `status` ("DUE"/"SETTLED") is derived from balance, not a stored column -
  // same "compute then filter/paginate in JS" pattern as RawMaterial's
  // isLow, since paginating in SQL first would drop matching rows before
  // the derived filter runs.
  async findAll(params: { search?: string; status?: 'DUE' | 'SETTLED'; page?: number; limit?: number } = {}) {
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where: Prisma.SupplierWhereInput = params.search ? { name: { contains: params.search } } : {};

    const suppliers = await this.prisma.supplier.findMany({
      where,
      include: { purchases: true, payments: true },
      orderBy: { name: 'asc' },
    });

    const mapped = suppliers.map((s) => {
      const totalPurchaseValue = s.purchases.reduce((sum, p) => sum + Number(p.value), 0);
      const totalPaid = s.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const balance = totalPurchaseValue - totalPaid;
      return {
        id: s.id,
        name: s.name,
        phone: s.phone,
        address: s.address,
        totalPurchaseValue,
        totalPaid,
        balance,
        status: (balance > 0 ? 'DUE' : 'SETTLED') as 'DUE' | 'SETTLED',
      };
    });
    const filtered = params.status ? mapped.filter((s) => s.status === params.status) : mapped;

    if (!paginated) return filtered;
    const { skip, take } = toSkipTake(page, limit);
    return paginate(filtered.slice(skip, skip + take), filtered.length, page, limit);
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        purchases: {
          orderBy: { date: 'asc' },
          include: {
            rawMaterial: { select: { id: true, name: true, unit: true, measurementKind: true } },
            // PUR number shown as the Ref No. on the page's party statement.
            purchase: { select: { id: true, purchaseNumber: true } },
          },
        },
        payments: { orderBy: { date: 'asc' } },
      },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const totalPurchaseValue = supplier.purchases.reduce((sum, p) => sum + Number(p.value), 0);

    let running = 0;
    const paymentsWithBalance = supplier.payments.map((p) => {
      running += Number(p.amount);
      return { ...p, balanceAfter: totalPurchaseValue - running };
    });

    const totalPaid = running;

    return {
      ...supplier,
      payments: paymentsWithBalance,
      totalPurchaseValue,
      totalPaid,
      balance: totalPurchaseValue - totalPaid,
    };
  }

  async create(dto: CreateSupplierDto) {
    const existing = await this.prisma.supplier.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A supplier with this name already exists');
    return this.prisma.supplier.create({ data: dto });
  }

  async update(id: string, dto: UpdateSupplierDto) {
    await this.findOne(id);
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  async remove(id: string, userId?: string, force = false, viewerRole?: Role) {
    const supplier = await this.findOne(id);
    // MySQL FK constraints aren't guaranteed to have actually been created
    // by `prisma db push` on every table (confirmed missing on at least one
    // other relation in this project, including Purchase.supplierId - hit
    // live as an orphaned-row crash) - blocking instead of relying on the
    // schema's onDelete/Restrict semantics avoids silently orphaning
    // purchase/payment rows.
    const purchaseCount = await this.prisma.purchase.count({ where: { supplierId: id } });
    const hasHistory = supplier.purchases.length > 0 || supplier.payments.length > 0 || purchaseCount > 0;

    if (hasHistory && !(force && viewerRole === Role.SUPERADMIN)) {
      if (force) throw new ForbiddenException('Only Super Admin can force this delete through');
      throw new ConflictException(
        'This supplier has purchases or payment history and cannot be deleted. Remove those entries first if you really need to delete the supplier.',
      );
    }

    if (hasHistory) {
      // Force path (SUPERADMIN only): this supplier's own purchase/payment
      // ledger is genuinely erased, not just detached - SupplierPurchase/
      // SupplierPayment/Purchase all require a supplierId. Any StockMovement
      // linked to a deleted Purchase/SupplierPurchase just loses that
      // reference (both are nullable there), the movement itself survives.
      const purchaseIds = (await this.prisma.purchase.findMany({ where: { supplierId: id }, select: { id: true } })).map((p) => p.id);
      await this.prisma.$transaction([
        this.prisma.purchaseItem.deleteMany({ where: { purchaseId: { in: purchaseIds } } }),
        this.prisma.purchase.deleteMany({ where: { supplierId: id } }),
        this.prisma.supplierPurchase.deleteMany({ where: { supplierId: id } }),
        this.prisma.supplierPayment.deleteMany({ where: { supplierId: id } }),
      ]);
      if (userId) {
        await this.audit.log({
          userId,
          action: 'FORCE_DELETE_SUPPLIER',
          targetType: 'Supplier',
          targetId: id,
          metadata: { name: supplier.name, purchaseCount, supplierPurchaseCount: supplier.purchases.length, paymentCount: supplier.payments.length },
        });
      }
    }

    await this.prisma.supplier.delete({ where: { id } });
    return { success: true };
  }

  async addPayment(supplierId: string, dto: CreateSupplierPaymentDto, userId: string) {
    await this.findOne(supplierId);
    await this.prisma.supplierPayment.create({
      data: {
        supplierId,
        date: new Date(dto.date),
        particulars: dto.particulars,
        voucherNo: dto.voucherNo,
        amount: dto.amount,
        mode: dto.mode,
        createdById: userId,
      },
    });
    return this.findOne(supplierId);
  }

  async updatePayment(supplierId: string, paymentId: string, dto: Partial<CreateSupplierPaymentDto>) {
    const payment = await this.prisma.supplierPayment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.supplierId !== supplierId) throw new NotFoundException('Payment not found');
    await this.prisma.supplierPayment.update({
      where: { id: paymentId },
      data: {
        date: dto.date ? new Date(dto.date) : undefined,
        particulars: dto.particulars,
        voucherNo: dto.voucherNo,
        amount: dto.amount,
        mode: dto.mode,
      },
    });
    return this.findOne(supplierId);
  }

  async removePayment(supplierId: string, paymentId: string) {
    const payment = await this.prisma.supplierPayment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.supplierId !== supplierId) throw new NotFoundException('Payment not found');
    await this.prisma.supplierPayment.delete({ where: { id: paymentId } });
    return this.findOne(supplierId);
  }

  // Suppliers list PDF - exactly the filtered rows the list page is showing,
  // never the whole table.
  async generateListPdf(params: { search?: string; status?: 'DUE' | 'SETTLED' }): Promise<Buffer> {
    const suppliers = (await this.findAll(params)) as any[];
    const rows = suppliers
      .map(
        (s) => `<tr>
          <td>${escapeHtml(s.name)}</td>
          <td>${escapeHtml(s.phone ?? '-')}</td>
          <td style="text-align:right">₹${s.totalPurchaseValue.toLocaleString('en-IN')}</td>
          <td style="text-align:right">₹${s.totalPaid.toLocaleString('en-IN')}</td>
          <td style="text-align:right">₹${s.balance.toLocaleString('en-IN')}</td>
          <td>${s.status === 'DUE' ? 'Due' : 'Settled'}</td>
        </tr>`,
      )
      .join('');

    const filterSummary = renderFilterSummary({
      Search: params.search,
      Status: params.status ? (params.status === 'DUE' ? 'Due' : 'Settled') : undefined,
    });

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${REPORT_PDF_STYLES}</style></head>
<body>
  ${renderReportHeader('Suppliers')}
  <div class="body">
    ${filterSummary}
    <table>
      <thead><tr><th>Supplier Name</th><th>Phone</th><th style="text-align:right">Total Purchases</th><th style="text-align:right">Paid</th><th style="text-align:right">Balance Payable</th><th>Status</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:16px">No suppliers found</td></tr>'}</tbody>
    </table>
    ${renderGeneratedFooter(suppliers.length, 'supplier')}
  </div>
</body></html>`;
    return this.pdf.renderHtmlToPdf(html);
  }

  // Two-column letterhead shared by the supplier PDFs: supplier identity on
  // the left, SSS Furniture on the right.
  private letterhead(supplier: { name: string; phone: string | null }) {
    // Solid-fill phone icon (Heroicons "phone", 24x24 viewBox) - an inline
    // SVG path, not a Unicode glyph, so it renders correctly regardless of
    // what fonts are installed on the PDF-rendering server (see the ₹ glyph
    // issue this app hit with text-based symbols).
    const phoneIcon = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px;margin-right:5px"><path d="M2.25 6.75c0 8.284 6.716 15 15 15h1.5a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/></svg>`;

    // Two-column letterhead: supplier identity (with a "Supplier Name"
    // eyebrow label, since "SSS Furniture" now occupies the corner where a
    // reader would otherwise expect the issuing company's own name) on the
    // left, "SSS Furniture" right-aligned on the right - same maroon
    // .header band as every other report, just restructured for this one
    // statement rather than via the shared renderReportHeader().
    return `<div class="header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px">
      <div>
        <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#f5c2c9;margin-bottom:4px">Supplier Name</div>
        <h1 style="margin:0 0 8px">${escapeHtml(supplier.name)}</h1>
        ${supplier.phone ? `<div style="font-size:12px;color:#f5c2c9">${phoneIcon}${escapeHtml(supplier.phone)}</div>` : ''}
      </div>
      <div style="text-align:right;white-space:nowrap">
        <div style="font-size:17px;font-weight:bold">SSS Furniture</div>
        <div style="font-size:10.5px;color:#f5c2c9;margin-top:2px">Retail &middot; Wholesale</div>
      </div>
    </div>`;
  }

  // Supplier detail PDF - the complete supplier purchasing statement: this
  // one supplier's info, every Purchase Item line (never just a one-row-
  // per-purchase aggregate), and the full Payment Ledger, all read fresh
  // from findOne()/purchase.findMany() on every call - so a payment that
  // was just added or edited is reflected immediately, never a stale
  // frontend total. Read-only: no write happens anywhere in this method.
  async generateDetailPdf(id: string): Promise<Buffer> {
    const supplier = await this.findOne(id);
    const purchases = await this.prisma.purchase.findMany({
      where: { supplierId: id },
      include: { items: { include: { rawMaterial: { select: { name: true, unit: true } } } } },
      orderBy: { purchaseDate: 'desc' },
    });

    const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // One row per PurchaseItem (not one per Purchase) - each line has its
    // own Quantity/Unit/Purchase Rate, per the required column set.
    const itemRows = purchases
      .flatMap((p) =>
        p.items.map((i) => ({
          purchaseNumber: p.purchaseNumber,
          date: p.purchaseDate,
          material: i.rawMaterial.name,
          quantity: Number(i.quantity),
          unit: i.rawMaterial.unit,
          rate: Number(i.unitPrice),
          total: Number(i.quantity) * Number(i.unitPrice),
          status: p.status,
        })),
      )
      .map(
        (r) => `<tr>
          <td>${escapeHtml(r.purchaseNumber)}</td>
          <td>${r.date.toLocaleDateString('en-IN')}</td>
          <td>${escapeHtml(r.material)}</td>
          <td style="text-align:right">${r.quantity.toLocaleString('en-IN')}</td>
          <td>${escapeHtml(r.unit)}</td>
          <td style="text-align:right">${rupees(r.rate)}</td>
          <td style="text-align:right">${rupees(r.total)}</td>
          <td>${escapeHtml(r.status)}</td>
        </tr>`,
      )
      .join('');

    const paymentRows = supplier.payments
      .map(
        (p: any) => `<tr>
          <td>${new Date(p.date).toLocaleDateString('en-IN')}</td>
          <td>${escapeHtml(p.voucherNo ?? '-')}</td>
          <td style="text-align:right">${rupees(Number(p.amount))}</td>
          <td style="text-align:right">${p.balanceAfter != null ? rupees(Number(p.balanceAfter)) : '-'}</td>
          <td>${escapeHtml(p.mode ?? '-')}</td>
        </tr>`,
      )
      .join('');

    const header = this.letterhead(supplier);

    const summaryBlock = `<div class="summary">
      <div><div class="label">Total Purchases</div><div class="value">${rupees(supplier.totalPurchaseValue)}</div></div>
      <div><div class="label">Total Paid</div><div class="value" style="color:#15803d">${rupees(supplier.totalPaid)}</div></div>
      <div><div class="label">Balance Payable</div><div class="value" style="color:#b91c1c">${rupees(supplier.balance)}</div></div>
    </div>`;

    const itemCount = purchases.reduce((s, p) => s + p.items.length, 0);

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${REPORT_PDF_STYLES}</style></head>
<body>
  ${header}
  <div class="body">
    <h3 style="font-size:13px;margin:0 0 8px">Purchase Summary</h3>
    ${summaryBlock}
    <h3 style="font-size:13px;margin:18px 0 8px">Purchase Details</h3>
    <table>
      <thead><tr><th>Purchase No</th><th>Date</th><th>Item</th><th style="text-align:right">Quantity</th><th>Unit</th><th style="text-align:right">Purchase Rate</th><th style="text-align:right">Total</th><th>Status</th></tr></thead>
      <tbody>${itemRows || '<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:16px">No purchases</td></tr>'}</tbody>
    </table>
    <h3 style="font-size:13px;margin:18px 0 8px">Payment Ledger</h3>
    <table>
      <thead><tr><th>Date</th><th>Voucher No</th><th style="text-align:right">Amount</th><th style="text-align:right">Balance</th><th>Mode</th></tr></thead>
      <tbody>
        ${paymentRows || '<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:16px">No payments</td></tr>'}
        ${
          supplier.payments.length > 0
            ? `<tr style="font-weight:bold"><td colspan="2">Total Paid</td><td style="text-align:right">${rupees(supplier.totalPaid)}</td><td></td><td></td></tr>
               <tr style="font-weight:bold;border-top:2px solid #1f2933"><td colspan="3">Balance Payable</td><td style="text-align:right">${rupees(supplier.balance)}</td><td></td></tr>`
            : ''
        }
      </tbody>
    </table>
    <h3 style="font-size:13px;margin:18px 0 8px">Financial Summary</h3>
    ${summaryBlock}
    <p style="margin:22px 0 0;padding-top:14px;border-top:1px solid #e3e1d9;font-size:11.5px;color:#6b7280;font-style:italic">Thank you for your continued partnership with SSS Furniture.</p>
    ${renderGeneratedFooter(itemCount, 'purchase item')}
  </div>
</body></html>`;
    return this.pdf.renderHtmlToPdf(html, { pageNumbers: true });
  }

  // Payment Ledger only, as a party statement: every booked purchase and
  // every payment, oldest first, with a running payable balance - same rows
  // and order as the Payment Ledger on the supplier page (a purchase sorts
  // before a payment on the same day), ending at Balance Payable.
  async generateLedgerPdf(id: string): Promise<Buffer> {
    const supplier = await this.findOne(id);
    const rupees = (n: number) => `${n < 0 ? '-' : ''}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

    type Row = { kind: 'purchase' | 'payment'; date: Date; ref: string; amount: number; detail: string };
    const rows: Row[] = [
      ...supplier.purchases.map((p) => ({ kind: 'purchase' as const, date: p.date, ref: p.purchase?.purchaseNumber ?? '-', amount: Number(p.value), detail: p.particulars })),
      ...supplier.payments.map((p) => ({ kind: 'payment' as const, date: p.date, ref: p.voucherNo ?? '-', amount: Number(p.amount), detail: p.mode ?? '-' })),
    ].sort((a, b) => day(a.date).localeCompare(day(b.date)) || (a.kind === b.kind ? 0 : a.kind === 'purchase' ? -1 : 1));

    let balance = 0;
    const body = rows
      .map((r) => {
        balance += r.kind === 'purchase' ? r.amount : -r.amount;
        const main = `<tr style="${r.kind === 'payment' ? 'background:#f0fdf4' : ''}">
          <td>${fmt(r.date)}</td>
          <td style="font-weight:600">${r.kind === 'payment' ? 'Payment' : r.amount < 0 ? 'Cancelled' : 'Purchase'}</td>
          <td style="white-space:nowrap">${escapeHtml(r.ref)}</td>
          <td style="text-align:right">${rupees(r.amount)}</td>
          <td style="text-align:right">${rupees(r.kind === 'payment' ? r.amount : 0)}</td>
          <td style="text-align:right">${r.kind === 'purchase' ? rupees(r.amount) : ''}</td>
          <td style="text-align:right;font-weight:600">${rupees(balance)}</td>
        </tr>`;
        const sub = `<tr style="${r.kind === 'payment' ? 'background:#f0fdf4' : ''}"><td></td><td colspan="6" style="font-size:10.5px;color:#6b7280;padding-top:0">${
          r.kind === 'payment' ? `<b>Payment Type:</b> ${escapeHtml(r.detail)}` : escapeHtml(r.detail)
        }</td></tr>`;
        return main + sub;
      })
      .join('');

    const purchased = rows.filter((r) => r.kind === 'purchase').reduce((t, r) => t + r.amount, 0);
    const paid = rows.filter((r) => r.kind === 'payment').reduce((t, r) => t + r.amount, 0);

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${REPORT_PDF_STYLES}</style></head>
<body>
  ${this.letterhead(supplier)}
  <div class="body">
    <h2 style="text-align:center;font-size:18px;margin:4px 0 14px;text-decoration:underline">Party Statement - Payment Ledger</h2>
    <table>
      <thead><tr><th>Date</th><th>Txn Type</th><th>Ref No.</th><th style="text-align:right">Total</th><th style="text-align:right">Paid</th><th style="text-align:right">Txn Balance</th><th style="text-align:right">Payable Balance</th></tr></thead>
      <tbody>
        ${body || '<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:16px">No purchases or payments</td></tr>'}
        ${rows.length ? `<tr style="font-weight:bold;background:#e5e7eb"><td></td><td>Total</td><td></td><td style="text-align:right">${rupees(purchased)}</td><td style="text-align:right">${rupees(paid)}</td><td></td><td style="text-align:right">${rupees(balance)}</td></tr>` : ''}
      </tbody>
    </table>
    ${renderGeneratedFooter(rows.length, 'transaction')}
  </div>
</body></html>`;
    return this.pdf.renderHtmlToPdf(html, { pageNumbers: true });
  }

  // Purchases box only: one row per purchase, exactly as the supplier page
  // lists it (first material + quantity, "+N more"), oldest first. The
  // total counts received purchases only, so it equals Total Purchases.
  async generatePurchasesPdf(id: string): Promise<Buffer> {
    const supplier = await this.prisma.supplier.findUnique({ where: { id }, select: { name: true, phone: true } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    const purchases = await this.prisma.purchase.findMany({
      where: { supplierId: id },
      include: { items: { include: { rawMaterial: { select: { name: true, unit: true } } } } },
      orderBy: [{ purchaseDate: 'asc' }, { purchaseNumber: 'asc' }],
    });
    const rupees = (n: number) => `${n < 0 ? '-' : ''}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const STATUS: Record<string, string> = { PENDING_APPROVAL: 'Pending Approval', APPROVED: 'Approved - Awaiting Receipt', RECORDED: 'Received', CANCELLED: 'Cancelled' };
    const summary = (p: (typeof purchases)[number]) => {
      if (!p.items.length) return '-';
      const first = p.items[0];
      const pieces = first.pieces != null ? `, ${first.pieces} pcs` : '';
      const text = `${first.rawMaterial?.name ?? 'Material'} (${Number(first.quantity)} ${first.rawMaterial?.unit ?? ''}${pieces})`;
      return p.items.length === 1 ? text : `${text} +${p.items.length - 1} more`;
    };
    const rows = purchases.map((p) => ({ p, total: p.items.reduce((t, i) => t + Number(i.quantity) * Number(i.unitPrice), 0) }));
    const received = rows.filter((r) => r.p.status === 'RECORDED');
    const receivedTotal = received.reduce((t, r) => t + r.total, 0);
    const notReceived = rows.filter((r) => r.p.status !== 'RECORDED');

    const body = rows
      .map(
        ({ p, total }) => `<tr${p.status === 'CANCELLED' ? ' style="color:#9ca3af;text-decoration:line-through"' : ''}>
          <td style="white-space:nowrap;font-weight:600">${escapeHtml(p.purchaseNumber)}</td>
          <td style="white-space:nowrap">${fmt(p.purchaseDate)}</td>
          <td>${escapeHtml(summary(p))}</td>
          <td style="text-align:right;white-space:nowrap">${rupees(total)}</td>
          <td style="white-space:nowrap">${escapeHtml(STATUS[p.status] ?? p.status)}</td>
        </tr>`,
      )
      .join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${REPORT_PDF_STYLES}</style></head>
<body>
  ${this.letterhead(supplier)}
  <div class="body">
    <h2 style="text-align:center;font-size:18px;margin:4px 0 14px;text-decoration:underline">Purchases</h2>
    <table>
      <thead><tr><th>Purchase No</th><th>Date</th><th>Items</th><th style="text-align:right">Total</th><th>Status</th></tr></thead>
      <tbody>
        ${body || '<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:16px">No purchases</td></tr>'}
        ${rows.length ? `<tr style="font-weight:bold;background:#e5e7eb"><td colspan="3">Total (${received.length} received)</td><td style="text-align:right;white-space:nowrap">${rupees(receivedTotal)}</td><td></td></tr>` : ''}
      </tbody>
    </table>
    ${notReceived.length ? `<p style="font-size:10.5px;color:#6b7280;margin:8px 0 0">Not counted in the total: ${notReceived.map((r) => `${escapeHtml(r.p.purchaseNumber)} (${escapeHtml(STATUS[r.p.status] ?? r.p.status)})`).join(', ')}.</p>` : ''}
    ${renderGeneratedFooter(rows.length, 'purchase')}
  </div>
</body></html>`;
    return this.pdf.renderHtmlToPdf(html, { pageNumbers: true });
  }
}
