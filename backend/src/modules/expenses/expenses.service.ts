import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { paginate, toSkipTake } from '../../common/utils/pagination.util';
import { PdfService } from '../pdf/pdf.service';
import { escapeHtml, renderFilterSummary, renderGeneratedFooter, renderReportHeader, REPORT_PDF_STYLES } from '../../common/utils/pdf-report.util';

export interface ExpenseFilters {
  dateFrom?: string;
  dateTo?: string;
  categoryId?: string;
  referenceTypeId?: string;
  paymentModeId?: string;
  scope?: 'COMPANY' | 'PERSONAL';
  paidBy?: string;
  employeeId?: string;
  status?: 'ACTIVE' | 'ARCHIVED';
  minAmount?: number;
  maxAmount?: number;
  search?: string;
  page?: number;
  limit?: number;
}

const EXPENSE_INCLUDE = {
  category: true,
  referenceType: true,
  paymentMode: true,
  employee: { select: { id: true, name: true, phone: true } },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
} satisfies Prisma.ExpenseInclude;

@Injectable()
export class ExpensesService {
  constructor(
    private prisma: PrismaService,
    private pdf?: PdfService,
  ) {}

  private buildWhere(filters: ExpenseFilters): Prisma.ExpenseWhereInput {
    return {
      status: filters.status ?? 'ACTIVE',
      date:
        filters.dateFrom || filters.dateTo
          ? {
              gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
              lte: filters.dateTo ? new Date(filters.dateTo + 'T23:59:59.999Z') : undefined,
            }
          : undefined,
      categoryId: filters.categoryId,
      referenceTypeId: filters.referenceTypeId,
      paymentModeId: filters.paymentModeId,
      scope: filters.scope,
      employeeId: filters.employeeId,
      paidBy: filters.paidBy ? { contains: filters.paidBy } : undefined,
      amount:
        filters.minAmount != null || filters.maxAmount != null
          ? { gte: filters.minAmount, lte: filters.maxAmount }
          : undefined,
      OR: this.searchConditions(filters.search),
    };
  }

  // One box for everything shown in the list. Voucher number and amount are
  // number columns, so they match exactly: "845" or "V845" finds voucher 845,
  // and "2500" or "2,500" also finds that amount. "V845" means the voucher only.
  private searchConditions(raw?: string): Prisma.ExpenseWhereInput[] | undefined {
    const q = raw?.trim();
    if (!q) return undefined;
    const conditions: Prisma.ExpenseWhereInput[] = [
      { particulars: { contains: q } },
      { vendorName: { contains: q } },
      { notes: { contains: q } },
      { paidBy: { contains: q } },
      { paymentMode: { name: { contains: q } } },
      { referenceType: { code: { contains: q } } },
    ];
    const voucherOnly = /^v[\s.-]*(\d{1,9})$/i.exec(q);
    if (voucherOnly) conditions.push({ voucherNumber: Number(voucherOnly[1]) });
    const number = q.replace(/[₹,\s]/g, '');
    if (/^\d{1,10}(\.\d{1,2})?$/.test(number)) {
      conditions.push({ amount: Number(number) });
      if (/^\d{1,9}$/.test(number)) conditions.push({ voucherNumber: Number(number) });
    }
    return conditions;
  }

  // Opt-in pagination (see the identical pattern used across the app's other
  // list endpoints) - additionally returns totalAmount, the sum over every
  // matching row (not just the current page), so a filtered view like
  // "Purchase this month" can show its own running total in the header.
  async findAll(filters: ExpenseFilters) {
    const paginated = filters.page != null;
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const where = this.buildWhere(filters);

    const [items, total, sum] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        include: EXPENSE_INCLUDE,
        orderBy: [{ date: 'desc' }, { voucherNumber: 'desc' }],
        ...(paginated ? toSkipTake(page, limit) : {}),
      }),
      paginated ? this.prisma.expense.count({ where }) : Promise.resolve(0),
      this.prisma.expense.aggregate({ where, _sum: { amount: true } }),
    ]);

    const totalAmount = Number(sum._sum.amount ?? 0);
    if (!paginated) return { data: items, totalAmount };
    return { ...paginate(items, total, page, limit), totalAmount };
  }

  async generatePdf(filters: ExpenseFilters): Promise<Buffer> {
    const rows = await this.prisma.expense.findMany({
      where: this.buildWhere(filters),
      include: EXPENSE_INCLUDE,
      orderBy: [{ date: 'desc' }, { voucherNumber: 'desc' }],
    });
    const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10).split('-').reverse().join('-');
    const total = rows.reduce((t, e) => t + Number(e.amount), 0);

    const [category, mode] = await Promise.all([
      filters.categoryId ? this.prisma.expenseCategory.findUnique({ where: { id: filters.categoryId } }) : null,
      filters.paymentModeId ? this.prisma.expensePaymentMode.findUnique({ where: { id: filters.paymentModeId } }) : null,
    ]);
    const byMode = new Map<string, number>();
    for (const e of rows) byMode.set(e.paymentMode.name, (byMode.get(e.paymentMode.name) ?? 0) + Number(e.amount));

    const showCategory = !filters.categoryId;
    const body = rows
      .map(
        (e, i) => `<tr>
          <td>${i + 1}</td>
          <td style="white-space:nowrap">${day(e.date)}</td>
          <td>${escapeHtml(e.referenceType?.code ?? '-')}</td>
          <td>${e.voucherNumber ?? '-'}</td>
          <td>${escapeHtml(e.particulars)}</td>
          ${showCategory ? `<td>${escapeHtml(e.category.name)}</td>` : ''}
          <td style="white-space:nowrap">${escapeHtml(e.paymentMode.name)}</td>
          <td style="text-align:right;white-space:nowrap">${rupees(Number(e.amount))}</td>
          <td>${escapeHtml(e.paidBy ?? '-')}</td>
        </tr>`,
      )
      .join('');
    const columns = showCategory ? 9 : 8;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Expenses</title><style>${REPORT_PDF_STYLES}</style></head><body>
      ${renderReportHeader(`Expenses${category ? ` - ${category.name}` : ''}`)}
      <div class="body">
        ${renderFilterSummary({
          Category: category?.name,
          Type: filters.scope,
          'Date From': filters.dateFrom ? day(filters.dateFrom) : undefined,
          'Date To': filters.dateTo ? day(filters.dateTo) : undefined,
          Mode: mode?.name,
          Search: filters.search,
          Status: filters.status === 'ARCHIVED' ? 'Archived' : undefined,
        })}
        <div class="summary">
          <div><div class="label">Total</div><div class="value">${rupees(total)}</div></div>
          <div><div class="label">Entries</div><div class="value">${rows.length}</div></div>
          ${[...byMode.entries()].map(([name, amount]) => `<div><div class="label">${escapeHtml(name)}</div><div class="value">${rupees(amount)}</div></div>`).join('')}
        </div>
        <table>
          <thead><tr><th>S.No</th><th>Date</th><th>Ref</th><th>V</th><th>Particulars</th>${showCategory ? '<th>Category</th>' : ''}<th>Mode</th><th style="text-align:right">Debit</th><th>Paid By</th></tr></thead>
          <tbody>
            ${body || `<tr><td colspan="${columns}" style="text-align:center;color:#9ca3af;padding:16px">No entries</td></tr>`}
            ${rows.length ? `<tr style="font-weight:bold;background:#f4f2ec"><td colspan="${columns - 2}">Total</td><td style="text-align:right;white-space:nowrap">${rupees(total)}</td><td></td></tr>` : ''}
          </tbody>
        </table>
        ${renderGeneratedFooter(rows.length, 'entry').replace('entrys', 'entries')}
      </div></body></html>`;
    return this.pdf!.renderHtmlToPdf(html, { pageNumbers: true });
  }

  async findOne(id: string) {
    const expense = await this.prisma.expense.findUnique({ where: { id }, include: EXPENSE_INCLUDE });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  // Voucher No. is optional and never auto-filled. Blank and 0 may repeat;
  // any other number can belong to only one expense.
  private async assertVoucherFree(voucherNumber: number | null | undefined, excludeId?: string) {
    if (voucherNumber == null || voucherNumber === 0) return;
    const clash = await this.prisma.expense.findFirst({ where: { voucherNumber, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
    if (clash) throw new ConflictException(`Voucher number ${voucherNumber} is already in use`);
  }

  async create(dto: CreateExpenseDto, userId: string) {
    const voucherNumber = dto.voucherNumber ?? null;
    await this.assertVoucherFree(voucherNumber);

    const expense = await this.prisma.expense.create({
      data: {
        date: new Date(dto.date),
        voucherNumber,
        referenceTypeId: dto.referenceTypeId,
        categoryId: dto.categoryId,
        particulars: dto.particulars,
        amount: dto.amount,
        paymentModeId: dto.paymentModeId,
        scope: dto.scope ?? 'COMPANY',
        paidBy: dto.paidBy,
        employeeId: dto.employeeId,
        vendorName: dto.vendorName,
        description: dto.description,
        notes: dto.notes,
        attachmentUrl: dto.attachmentUrl,
        tags: dto.tags,
        createdById: userId,
      },
      include: EXPENSE_INCLUDE,
    });

    await this.prisma.expenseAuditLog.create({
      data: { expenseId: expense.id, action: 'CREATED', userId, changes: { amount: { old: null, new: dto.amount } } },
    });

    return expense;
  }

  async update(id: string, dto: UpdateExpenseDto, userId: string) {
    const existing = await this.findOne(id);

    if (dto.voucherNumber !== undefined && dto.voucherNumber !== existing.voucherNumber) {
      await this.assertVoucherFree(dto.voucherNumber, id);
    }

    // Diff only the fields actually present in the request, so the audit
    // trail records exactly what changed rather than every field every time.
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    const trackedFields: (keyof UpdateExpenseDto)[] = [
      'date', 'categoryId', 'particulars', 'amount', 'paymentModeId', 'scope',
      'paidBy', 'employeeId', 'vendorName', 'description', 'notes', 'voucherNumber', 'referenceTypeId',
    ];
    for (const field of trackedFields) {
      if (dto[field] === undefined) continue;
      const oldValue = (existing as any)[field === 'date' ? 'date' : field];
      const newValue = field === 'date' ? new Date(dto.date as string) : dto[field];
      const oldComparable = field === 'date' ? new Date(oldValue).toISOString() : oldValue;
      const newComparable = field === 'date' ? (newValue as Date).toISOString() : newValue;
      if (oldComparable !== newComparable) {
        changes[field] = { old: oldComparable, new: newComparable };
      }
    }

    const expense = await this.prisma.expense.update({
      where: { id },
      data: {
        date: dto.date ? new Date(dto.date) : undefined,
        voucherNumber: dto.voucherNumber,
        referenceTypeId: dto.referenceTypeId,
        categoryId: dto.categoryId,
        particulars: dto.particulars,
        amount: dto.amount,
        paymentModeId: dto.paymentModeId,
        scope: dto.scope,
        paidBy: dto.paidBy,
        employeeId: dto.employeeId,
        vendorName: dto.vendorName,
        description: dto.description,
        notes: dto.notes,
        attachmentUrl: dto.attachmentUrl,
        tags: dto.tags,
        updatedById: userId,
      },
      include: EXPENSE_INCLUDE,
    });

    if (Object.keys(changes).length > 0) {
      await this.prisma.expenseAuditLog.create({ data: { expenseId: id, action: 'UPDATED', userId, changes: changes as Prisma.InputJsonValue } });
    }

    return expense;
  }

  async archive(id: string, userId: string) {
    await this.findOne(id);
    const expense = await this.prisma.expense.update({ where: { id }, data: { status: 'ARCHIVED', updatedById: userId }, include: EXPENSE_INCLUDE });
    await this.prisma.expenseAuditLog.create({ data: { expenseId: id, action: 'ARCHIVED', userId } });
    return expense;
  }

  async restore(id: string, userId: string) {
    await this.findOne(id);
    const expense = await this.prisma.expense.update({ where: { id }, data: { status: 'ACTIVE', updatedById: userId }, include: EXPENSE_INCLUDE });
    await this.prisma.expenseAuditLog.create({ data: { expenseId: id, action: 'RESTORED', userId } });
    return expense;
  }

  // A hard delete removes the row (and, by cascade, its own audit trail
  // with it) - so unlike create/update/archive, this event is recorded in
  // the app's global AuditLog instead, which survives the row's removal.
  // See src/modules/audit - reused as-is, not duplicated.
  async remove(id: string, userId: string, audit: { log: (entry: any) => Promise<any> }) {
    const expense = await this.findOne(id);
    await this.prisma.expense.delete({ where: { id } });
    await audit.log({
      userId,
      action: 'EXPENSE_DELETED',
      targetType: 'Expense',
      targetId: id,
      metadata: { voucherNumber: expense.voucherNumber, particulars: expense.particulars, amount: Number(expense.amount) },
    });
    return { success: true };
  }

  async duplicate(id: string, userId: string) {
    const source = await this.findOne(id);
    const expense = await this.prisma.expense.create({
      data: {
        date: new Date(),
        voucherNumber: null,
        referenceTypeId: source.referenceTypeId,
        categoryId: source.categoryId,
        particulars: source.particulars,
        amount: source.amount,
        paymentModeId: source.paymentModeId,
        scope: source.scope,
        paidBy: source.paidBy,
        employeeId: source.employeeId,
        vendorName: source.vendorName,
        description: source.description,
        notes: source.notes,
        tags: source.tags,
        createdById: userId,
      },
      include: EXPENSE_INCLUDE,
    });
    await this.prisma.expenseAuditLog.create({
      data: { expenseId: expense.id, action: 'CREATED', userId, changes: { duplicatedFrom: { old: null, new: source.voucherNumber } } },
    });
    return expense;
  }

  async history(id: string) {
    await this.findOne(id);
    return this.prisma.expenseAuditLog.findMany({
      where: { expenseId: id },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --- Dashboard summary - every number here is a live aggregate, never a
  // manually-entered total (per the spec's explicit requirement). ---------

  async summary() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const activeWhere: Prisma.ExpenseWhereInput = { status: 'ACTIVE' };
    const sumSince = (since: Date) =>
      this.prisma.expense.aggregate({ where: { ...activeWhere, date: { gte: since } }, _sum: { amount: true } });

    const [overall, company, personal, today, week, month, year, byCategory, byPaymentMode] = await Promise.all([
      this.prisma.expense.aggregate({ where: activeWhere, _sum: { amount: true } }),
      this.prisma.expense.aggregate({ where: { ...activeWhere, scope: 'COMPANY' }, _sum: { amount: true } }),
      this.prisma.expense.aggregate({ where: { ...activeWhere, scope: 'PERSONAL' }, _sum: { amount: true } }),
      sumSince(startOfDay),
      sumSince(startOfWeek),
      sumSince(startOfMonth),
      sumSince(startOfYear),
      this.prisma.expense.groupBy({ by: ['categoryId'], where: activeWhere, _sum: { amount: true } }),
      this.prisma.expense.groupBy({ by: ['paymentModeId'], where: activeWhere, _sum: { amount: true } }),
    ]);

    const [categories, paymentModes] = await Promise.all([
      this.prisma.expenseCategory.findMany({ where: { id: { in: byCategory.map((c) => c.categoryId) } } }),
      this.prisma.expensePaymentMode.findMany({ where: { id: { in: byPaymentMode.map((p) => p.paymentModeId) } } }),
    ]);
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
    const paymentModeNameById = new Map(paymentModes.map((p) => [p.id, p.name]));

    const n = (v: Prisma.Decimal | null) => Number(v ?? 0);

    return {
      overallTotal: n(overall._sum.amount),
      companyTotal: n(company._sum.amount),
      personalTotal: n(personal._sum.amount),
      today: n(today._sum.amount),
      thisWeek: n(week._sum.amount),
      thisMonth: n(month._sum.amount),
      thisYear: n(year._sum.amount),
      byCategory: byCategory
        .map((c) => ({ categoryId: c.categoryId, categoryName: categoryNameById.get(c.categoryId) ?? 'Unknown', total: n(c._sum.amount) }))
        .sort((a, b) => b.total - a.total),
      byPaymentMode: byPaymentMode
        .map((p) => ({ paymentModeId: p.paymentModeId, paymentModeName: paymentModeNameById.get(p.paymentModeId) ?? 'Unknown', total: n(p._sum.amount) }))
        .sort((a, b) => b.total - a.total),
    };
  }

  async monthly(year: number, month: number) {
    if (month < 1 || month > 12) throw new BadRequestException('month must be 1-12');
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const where: Prisma.ExpenseWhereInput = { status: 'ACTIVE', date: { gte: start, lt: end } };

    const [total, company, personal, byCategory] = await Promise.all([
      this.prisma.expense.aggregate({ where, _sum: { amount: true } }),
      this.prisma.expense.aggregate({ where: { ...where, scope: 'COMPANY' }, _sum: { amount: true } }),
      this.prisma.expense.aggregate({ where: { ...where, scope: 'PERSONAL' }, _sum: { amount: true } }),
      this.prisma.expense.groupBy({ by: ['categoryId'], where, _sum: { amount: true } }),
    ]);

    const categories = await this.prisma.expenseCategory.findMany({ where: { id: { in: byCategory.map((c) => c.categoryId) } } });
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
    const n = (v: Prisma.Decimal | null) => Number(v ?? 0);

    return {
      year,
      month,
      total: n(total._sum.amount),
      company: n(company._sum.amount),
      personal: n(personal._sum.amount),
      byCategory: byCategory
        .map((c) => ({ categoryId: c.categoryId, categoryName: categoryNameById.get(c.categoryId) ?? 'Unknown', total: n(c._sum.amount) }))
        .sort((a, b) => b.total - a.total),
    };
  }
}
