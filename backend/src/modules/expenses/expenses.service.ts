import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { paginate, toSkipTake } from '../../common/utils/pagination.util';

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
  constructor(private prisma: PrismaService) {}

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
      OR: filters.search
        ? [
            { particulars: { contains: filters.search } },
            { vendorName: { contains: filters.search } },
            { notes: { contains: filters.search } },
            { paidBy: { contains: filters.search } },
          ]
        : undefined,
    };
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

  async findOne(id: string) {
    const expense = await this.prisma.expense.findUnique({ where: { id }, include: EXPENSE_INCLUDE });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  private async nextVoucherNumber(): Promise<number> {
    const result = await this.prisma.expense.aggregate({ _max: { voucherNumber: true } });
    return (result._max.voucherNumber ?? 0) + 1;
  }

  async create(dto: CreateExpenseDto, userId: string) {
    let voucherNumber = dto.voucherNumber;
    if (voucherNumber != null) {
      const clash = await this.prisma.expense.findUnique({ where: { voucherNumber } });
      if (clash) throw new ConflictException(`Voucher number ${voucherNumber} is already in use`);
    } else {
      voucherNumber = await this.nextVoucherNumber();
    }

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

    if (dto.voucherNumber != null && dto.voucherNumber !== existing.voucherNumber) {
      const clash = await this.prisma.expense.findUnique({ where: { voucherNumber: dto.voucherNumber } });
      if (clash) throw new ConflictException(`Voucher number ${dto.voucherNumber} is already in use`);
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
    const voucherNumber = await this.nextVoucherNumber();
    const expense = await this.prisma.expense.create({
      data: {
        date: new Date(),
        voucherNumber,
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
