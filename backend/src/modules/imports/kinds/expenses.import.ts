import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExpensesService } from '../../expenses/expenses.service';
import { CreateExpenseDto } from '../../expenses/dto/create-expense.dto';
import { Role } from '../../../common/enums/role.enum';
import { TableSpec } from '../../../common/import/sheet-reader';
import { blankToUndef, commitEach, day, gridNum, GridRow, HandlerPreviewRow, ImportContext, ImportHandler, matchByName, normName, num, sheetDate, text, validOrThrow } from '../import-handler';

// Expenses: one row = one expense, saved through ExpensesService.create so
// each gets the next voucher number. Category and payment mode are matched
// by name against Expenses > Settings; a category locked to Company or
// Personal sets the scope.
@Injectable()
export class ExpensesImport implements ImportHandler {
  readonly kind = 'expenses';
  readonly minRole = Role.SUPERADMIN as const;
  readonly spec: TableSpec<string> = {
    aliases: {
      DATE: 'date',
      V: 'voucherNumber',
      VNO: 'voucherNumber',
      VOUCHER: 'voucherNumber',
      VOUCHERNO: 'voucherNumber',
      VOUCHERNUMBER: 'voucherNumber',
      CATEGORY: 'category',
      HEAD: 'category',
      EXPENSETYPE: 'category',
      PARTICULARS: 'particulars',
      DESCRIPTION: 'particulars',
      DETAILS: 'particulars',
      PURPOSE: 'particulars',
      ITEM: 'particulars',
      AMOUNT: 'amount',
      MODE: 'paymentMode',
      PAYMENTMODE: 'paymentMode',
      PAIDVIA: 'paymentMode',
      SCOPE: 'scope',
      COMPANYPERSONAL: 'scope',
      PAIDBY: 'paidBy',
      VENDOR: 'vendorName',
      VENDORNAME: 'vendorName',
      PAIDTO: 'vendorName',
      PARTY: 'vendorName',
      NOTE: 'notes',
      NOTES: 'notes',
      REMARKS: 'notes',
    },
    headerRequired: ['date', 'amount'],
    dateColumn: 'date',
    label: 'DATE, CATEGORY, PARTICULARS, AMOUNT, MODE, SCOPE, PAID BY, VENDOR, NOTES',
  };

  constructor(
    private prisma: PrismaService,
    private expenses: ExpensesService,
  ) {}

  rowTotal(v: GridRow) {
    return gridNum(v.amount) ?? 0;
  }

  // Same day, same amount, same particulars.
  duplicateKey(row: GridRow) {
    const amount = gridNum(row.amount);
    if (!row.date || amount == null) return null;
    return `${row.date}|${amount.toFixed(2)}|${normName(row.particulars)}`;
  }

  async existingKeys(rows: GridRow[]) {
    const dates = [...new Set(rows.map((r) => r.date).filter(Boolean))].map((d) => new Date(d));
    if (!dates.length) return new Set<string>();
    const existing = await this.prisma.expense.findMany({ where: { status: 'ACTIVE', date: { in: dates } }, select: { date: true, amount: true, particulars: true } });
    return new Set(existing.map((e) => `${day(e.date)}|${Number(e.amount).toFixed(2)}|${normName(e.particulars)}`));
  }

  async preview(rows: { line: number; cells: Partial<Record<string, string>> }[]): Promise<HandlerPreviewRow[]> {
    const [categories, modes] = await Promise.all([
      this.prisma.expenseCategory.findMany({ where: { isActive: true }, select: { id: true, name: true, scope: true } }),
      this.prisma.expensePaymentMode.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    ]);
    const cash = modes.find((m) => normName(m.name) === 'CASH');
    return rows.map(({ line, cells }) => {
      const warnings: string[] = [];
      const hint = 'add it under Expenses > Settings, then pick it here';
      const categoryId = matchByName(categories, text(cells, 'category'), 'Category', warnings, hint);
      if (!text(cells, 'category')) warnings.push('Category is missing - pick one');
      const modeText = text(cells, 'paymentMode');
      const paymentModeId = modeText ? matchByName(modes, modeText, 'Payment mode', warnings, hint) : (cash?.id ?? '');
      const amount = num(text(cells, 'amount'));
      if (amount == null || amount <= 0) warnings.push(`Amount "${text(cells, 'amount')}" is missing or not a number`);
      const locked = categories.find((c) => c.id === categoryId)?.scope;
      const scope = locked ?? (normName(text(cells, 'scope')).startsWith('PERS') ? 'PERSONAL' : 'COMPANY');
      const particulars = text(cells, 'particulars') || text(cells, 'category');
      if (!particulars) warnings.push('Particulars is missing');
      return {
        line,
        warnings,
        values: {
          date: sheetDate(text(cells, 'date'), 'Date', warnings),
          voucherNumber: voucherOf(text(cells, 'voucherNumber'), warnings),
          categoryId,
          particulars,
          amount: amount != null && amount > 0 ? String(amount) : '',
          paymentModeId,
          scope,
          paidBy: text(cells, 'paidBy'),
          vendorName: text(cells, 'vendorName'),
          notes: text(cells, 'notes'),
        },
      };
    });
  }

  commit(items: GridRow[], ctx: ImportContext) {
    return commitEach(items, async (r) => {
      const dto = await validOrThrow(CreateExpenseDto, {
        date: r.date,
        voucherNumber: r.voucherNumber?.trim() ? Number(r.voucherNumber) : undefined,
        categoryId: r.categoryId,
        particulars: r.particulars?.trim(),
        amount: gridNum(r.amount),
        paymentModeId: r.paymentModeId,
        scope: r.scope || 'COMPANY',
        paidBy: blankToUndef(r.paidBy),
        vendorName: blankToUndef(r.vendorName),
        notes: blankToUndef(r.notes),
      });
      await this.expenses.create(dto, ctx.userId);
    });
  }
}

// V / Voucher column: blank or "-" = no voucher number (never auto-filled);
// otherwise a whole number, 0 allowed.
function voucherOf(raw: string, warnings: string[]): string {
  const t = (raw ?? '').trim();
  if (!t || t === '-') return '';
  if (!/^\d+$/.test(t)) {
    warnings.push(`Voucher No. "${t}" is not a number - left blank`);
    return '';
  }
  return String(Number(t));
}
