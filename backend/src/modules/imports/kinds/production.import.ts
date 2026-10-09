import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CarpenterService } from '../../carpenter/carpenter.service';
import { CreateWorkItemDto } from '../../carpenter/dto/create-work-item.dto';
import { CreateCarpenterPaymentDto } from '../../carpenter/dto/create-carpenter-payment.dto';
import { buildWorkRow, fillDownDates, paymentTypeOf, WORK_SPEC, WORKER_PAYMENT_SPEC, WorkColumn } from '../../carpenter/work-import.parser';
import { Role } from '../../../common/enums/role.enum';
import { TableSpec } from '../../../common/import/sheet-reader';
import { blankToUndef, commitEach, day, gridNum, GridRow, HandlerPreviewRow, ImportContext, ImportHandler, matchByName, normName, num, sheetDate, text, validOrThrow } from '../import-handler';

// Work done is identified by worker + day + Model No when there is one,
// otherwise worker + day + product + total. Model Nos restart (978...1000,
// then 1, 2, 3...), so the day is part of the key.
function workKey(carpenterId: string, workDate: string, modelNo: string | null | undefined, productName: string, total: number) {
  if (!carpenterId || !workDate) return null;
  const model = normName(modelNo);
  return model ? `${carpenterId}|${workDate}|M|${model}` : `${carpenterId}|${workDate}|P|${normName(productName)}|${Math.round(total)}`;
}

const workTotal = (v: GridRow) => ((gridNum(v.price) ?? 0) + (gridNum(v.extra) ?? 0)) * (gridNum(v.quantity) ?? 1);

// Sheet rows -> grid rows, with blank dates filled from the row above.
function workRows(rows: { line: number; cells: Partial<Record<string, string>> }[]): HandlerPreviewRow[] {
  return fillDownDates(rows.map((r) => buildWorkRow(r.line, r.cells as Partial<Record<WorkColumn, string>>))).map(toWorkValues);
}

function toWorkValues(r: ReturnType<typeof buildWorkRow>): HandlerPreviewRow {
  const line = r.line;
  return {
    line,
    warnings: r.warnings,
    values: {
      stage: 'CARPENTER',
      workDate: r.workDate ?? '',
      modelNo: r.modelNo,
      productName: r.productName,
      category: r.category,
      size: r.size,
      quantity: String(r.quantity),
      price: String(r.price),
      extra: String(r.extra),
    },
  };
}

async function existingWorkKeys(prisma: PrismaService, carpenterIds: string[]) {
  const items = await prisma.carpenterWorkItem.findMany({
    where: { carpenterId: { in: carpenterIds } },
    select: { carpenterId: true, workDate: true, modelNo: true, productName: true, total: true },
  });
  return new Set(items.map((w) => workKey(w.carpenterId ?? '', day(w.workDate), w.modelNo, w.productName, Number(w.total))).filter((k): k is string => !!k));
}

// Old (already finished) work entry - saved through the same Super Admin
// "Record Old Entry" path as the single form: COMPLETED, price kept, no
// WhatsApp, no stage handoff.
async function saveOldEntry(carpenter: CarpenterService, carpenterId: string, r: GridRow, ctx: ImportContext) {
  const dto = await validOrThrow(CreateWorkItemDto, {
    carpenterId,
    stage: r.stage || 'CARPENTER',
    workDate: r.workDate,
    modelNo: blankToUndef(r.modelNo),
    productName: r.productName?.trim(),
    category: blankToUndef(r.category),
    size: blankToUndef(r.size),
    quantity: Math.round(gridNum(r.quantity) ?? 1),
    price: gridNum(r.price) ?? 0,
    extra: gridNum(r.extra) ?? 0,
    directRecord: true,
  });
  await carpenter.createWorkItem(dto, ctx.userId, ctx.role);
}

// Production > worker page > Work List (scoped to that one worker).
@Injectable()
export class WorkerWorkImport implements ImportHandler {
  readonly kind = 'worker-work';
  readonly minRole = Role.SUPERADMIN as const;
  readonly requiredScope = ['carpenterId'];
  readonly spec = WORK_SPEC as TableSpec<string>;

  constructor(
    private prisma: PrismaService,
    private carpenter: CarpenterService,
  ) {}

  rowTotal = workTotal;

  duplicateKey(row: GridRow, _all: GridRow[], ctx: ImportContext) {
    return workKey(ctx.scope.carpenterId, row.workDate, row.modelNo, row.productName ?? '', workTotal(row));
  }

  existingKeys(_rows: GridRow[], ctx: ImportContext) {
    return existingWorkKeys(this.prisma, [ctx.scope.carpenterId]);
  }

  async preview(rows: { line: number; cells: Partial<Record<string, string>> }[]) {
    return workRows(rows);
  }

  commit(items: GridRow[], ctx: ImportContext) {
    return commitEach(items, (r) => saveOldEntry(this.carpenter, ctx.scope.carpenterId, r, ctx));
  }
}

// Production Control: old work entries for any workers in one sheet - the
// Work List columns plus a Worker column (matched by name).
@Injectable()
export class ProductionWorkImport implements ImportHandler {
  readonly kind = 'production-work';
  readonly minRole = Role.SUPERADMIN as const;
  readonly spec: TableSpec<string> = {
    ...(WORK_SPEC as TableSpec<string>),
    aliases: { ...WORK_SPEC.aliases, WORKER: 'worker', WORKERNAME: 'worker', CARPENTER: 'worker', EMPLOYEE: 'worker', EMPLOYEENAME: 'worker', STAGE: 'stage' },
    headerRequired: ['date', 'worker', 'productName', 'price'],
    label: 'WORKER, STAGE, DATE, MODEL-NO, PRODUCT NAME, PRODUCT, SIZE, PRICE, EXTRA, NO, TOTAL',
  };

  constructor(
    private prisma: PrismaService,
    private carpenter: CarpenterService,
  ) {}

  rowTotal = workTotal;

  duplicateKey(row: GridRow) {
    return workKey(row.carpenterId, row.workDate, row.modelNo, row.productName ?? '', workTotal(row));
  }

  existingKeys(rows: GridRow[]) {
    return existingWorkKeys(this.prisma, [...new Set(rows.map((r) => r.carpenterId).filter(Boolean))]);
  }

  async preview(rows: { line: number; cells: Partial<Record<string, string>> }[]) {
    const workers = await this.prisma.carpenter.findMany({ select: { id: true, name: true } });
    const base = workRows(rows);
    return rows.map(({ cells }, i) => {
      const out = base[i];
      out.values.carpenterId = matchByName(workers, text(cells, 'worker'), 'Worker', out.warnings, 'add the worker under Production first, then pick them here');
      if (!text(cells, 'worker')) out.warnings.push('Worker is missing');
      const stage = normName(text(cells, 'stage'));
      out.values.stage = stage.startsWith('CARV') ? 'CARVING' : stage.startsWith('POL') ? 'POLISH' : 'CARPENTER';
      return out;
    });
  }

  commit(items: GridRow[], ctx: ImportContext) {
    return commitEach(items, (r) => saveOldEntry(this.carpenter, r.carpenterId, r, ctx));
  }
}

// Production > worker page > Payments (scoped to that one worker).
@Injectable()
export class WorkerPaymentsImport implements ImportHandler {
  readonly kind = 'worker-payments';
  readonly minRole = Role.ADMIN as const;
  readonly requiredScope = ['carpenterId'];
  readonly spec = WORKER_PAYMENT_SPEC as TableSpec<string>;

  constructor(
    private prisma: PrismaService,
    private carpenter: CarpenterService,
  ) {}

  rowTotal(v: GridRow) {
    return gridNum(v.amount) ?? 0;
  }

  // Same day + amount + voucher no (or, with no voucher, + type).
  duplicateKey(row: GridRow, _all: GridRow[], ctx: ImportContext) {
    const amount = gridNum(row.amount);
    if (!row.date || amount == null) return null;
    return payKey(ctx.scope.carpenterId, row.date, amount, row.reference, row.paymentType);
  }

  async existingKeys(_rows: GridRow[], ctx: ImportContext) {
    const payments = await this.prisma.carpenterPayment.findMany({ where: { carpenterId: ctx.scope.carpenterId }, select: { date: true, amount: true, reference: true, paymentType: true } });
    return new Set(payments.map((p) => payKey(ctx.scope.carpenterId, day(p.date), Number(p.amount), p.reference, p.paymentType)));
  }

  async preview(rows: { line: number; cells: Partial<Record<string, string>> }[]): Promise<HandlerPreviewRow[]> {
    return rows.map(({ line, cells }) => {
      const warnings: string[] = [];
      const amount = num(text(cells, 'amount'));
      if (amount == null || amount <= 0) warnings.push(`Amount "${text(cells, 'amount')}" is missing or not a number`);
      let type = paymentTypeOf(text(cells, 'type'));
      if (!type) {
        warnings.push(`Type "${text(cells, 'type')}" not recognised - set to Other`);
        type = 'OTHER';
      }
      return {
        line,
        warnings,
        values: {
          date: sheetDate(text(cells, 'date'), 'Date', warnings),
          paymentType: type,
          reference: text(cells, 'reference'),
          amount: amount != null && amount > 0 ? String(amount) : '',
          mode: text(cells, 'mode').toUpperCase() || 'CASH',
          note: text(cells, 'note'),
        },
      };
    });
  }

  commit(items: GridRow[], ctx: ImportContext) {
    return commitEach(items, async (r) => {
      const dto = await validOrThrow(CreateCarpenterPaymentDto, {
        date: r.date,
        amount: gridNum(r.amount),
        paymentType: r.paymentType || 'SALARY',
        reference: blankToUndef(r.reference),
        mode: blankToUndef(r.mode?.toUpperCase()),
        note: blankToUndef(r.note),
      });
      await this.carpenter.addPayment(ctx.scope.carpenterId, dto, ctx.userId);
    });
  }
}

export function payKey(targetId: string, date: string, amount: number, reference?: string | null, type?: string | null) {
  const ref = normName(reference);
  return ref ? `${targetId}|${date}|${amount.toFixed(2)}|R|${ref}` : `${targetId}|${date}|${amount.toFixed(2)}|T|${type ?? 'SALARY'}`;
}
