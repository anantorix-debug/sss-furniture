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
          include: { rawMaterial: { select: { id: true, name: true, unit: true, measurementKind: true } } },
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

  // Supplier detail PDF - this one supplier only: its info, its own
  // Purchases, its own Payment Ledger, never another supplier's data.
  async generateDetailPdf(id: string): Promise<Buffer> {
    const supplier = await this.findOne(id);
    const purchases = await this.prisma.purchase.findMany({
      where: { supplierId: id },
      include: { items: true },
      orderBy: { purchaseDate: 'desc' },
    });

    const poRows = purchases
      .map((p) => {
        const total = p.items.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0);
        return `<tr>
          <td>${escapeHtml(p.purchaseNumber)}</td>
          <td>${p.purchaseDate.toLocaleDateString('en-IN')}</td>
          <td>${p.items.length}</td>
          <td style="text-align:right">₹${total.toLocaleString('en-IN')}</td>
          <td>${escapeHtml(p.status)}</td>
        </tr>`;
      })
      .join('');

    const paymentRows = supplier.payments
      .map(
        (p: any) => `<tr>
          <td>${new Date(p.date).toLocaleDateString('en-IN')}</td>
          <td>${escapeHtml(p.voucherNo ?? '-')}</td>
          <td style="text-align:right">₹${Number(p.amount).toLocaleString('en-IN')}</td>
          <td style="text-align:right">₹${p.balanceAfter != null ? Number(p.balanceAfter).toLocaleString('en-IN') : '-'}</td>
          <td>${escapeHtml(p.mode ?? '-')}</td>
        </tr>`,
      )
      .join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${REPORT_PDF_STYLES}</style></head>
<body>
  ${renderReportHeader(supplier.name)}
  <div class="body">
    <p style="margin:0 0 14px;color:#6b7280;font-size:12px">${supplier.phone ? escapeHtml(supplier.phone) : ''}</p>
    <div class="summary">
      <div><div class="label">Total Purchases</div><div class="value">₹${supplier.totalPurchaseValue.toLocaleString('en-IN')}</div></div>
      <div><div class="label">Total Paid</div><div class="value" style="color:#15803d">₹${supplier.totalPaid.toLocaleString('en-IN')}</div></div>
      <div><div class="label">Balance Payable</div><div class="value" style="color:#b91c1c">₹${supplier.balance.toLocaleString('en-IN')}</div></div>
    </div>
    <h3 style="font-size:13px;margin:18px 0 8px">Purchases</h3>
    <table>
      <thead><tr><th>Purchase No</th><th>Date</th><th>Items</th><th style="text-align:right">Total</th><th>Status</th></tr></thead>
      <tbody>${poRows || '<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:16px">No purchases</td></tr>'}</tbody>
    </table>
    <h3 style="font-size:13px;margin:18px 0 8px">Payment Ledger</h3>
    <table>
      <thead><tr><th>Date</th><th>Voucher No</th><th style="text-align:right">Amount</th><th style="text-align:right">Balance</th><th>Mode</th></tr></thead>
      <tbody>${paymentRows || '<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:16px">No payments</td></tr>'}</tbody>
    </table>
    ${renderGeneratedFooter(purchases.length, 'purchase')}
  </div>
</body></html>`;
    return this.pdf.renderHtmlToPdf(html);
  }
}
