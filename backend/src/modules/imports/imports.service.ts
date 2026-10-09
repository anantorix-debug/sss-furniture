import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Role } from '../../common/enums/role.enum';
import { readTable, UploadedSheet } from '../../common/import/sheet-reader';
import { CommitResult, DuplicateKind, GridRow, ImportContext, ImportHandler } from './import-handler';
import { CustomerOrdersImport } from './kinds/customer-orders.import';
import { PartyOrdersImport } from './kinds/party-orders.import';
import { ProductsImport, RawMaterialsImport } from './kinds/inventory.import';
import { PurchasesImport, SuppliersImport } from './kinds/purchasing.import';
import { ProductionWorkImport, WorkerPaymentsImport, WorkerWorkImport } from './kinds/production.import';
import { PaymentsImport } from './kinds/payments.import';
import { ExpensesImport } from './kinds/expenses.import';

const MAX_ROWS = 1000;

// The one place every bulk upload / "Add Multiple" grid goes through:
// access check, file reading, duplicate check (against the database and
// within the batch), and saving. The per-page specifics live in ./kinds.
@Injectable()
export class ImportsService {
  private readonly handlers: Map<string, ImportHandler>;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    customerOrders: CustomerOrdersImport,
    partyOrders: PartyOrdersImport,
    products: ProductsImport,
    rawMaterials: RawMaterialsImport,
    suppliers: SuppliersImport,
    purchases: PurchasesImport,
    workerWork: WorkerWorkImport,
    workerPayments: WorkerPaymentsImport,
    productionWork: ProductionWorkImport,
    payments: PaymentsImport,
    expenses: ExpensesImport,
  ) {
    const all: ImportHandler[] = [customerOrders, partyOrders, products, rawMaterials, suppliers, purchases, workerWork, workerPayments, productionWork, payments, expenses];
    this.handlers = new Map(all.map((h) => [h.kind, h]));
  }

  // Resolves the kind and enforces the same role its page's own "create"
  // needs (Super Admin always passes, as everywhere in the app), plus any
  // record the upload is scoped to.
  private async open(kind: string, user: { userId: string; role: Role }, scope: Record<string, string> = {}, options: Record<string, boolean> = {}) {
    const handler = this.handlers.get(kind);
    if (!handler) throw new NotFoundException(`Unknown upload type "${kind}"`);
    if (handler.minRole === Role.SUPERADMIN && user.role !== Role.SUPERADMIN) {
      throw new ForbiddenException('Only Super Admin can do this upload');
    }
    const cleanScope: Record<string, string> = {};
    for (const key of handler.requiredScope ?? []) {
      const value = scope[key]?.trim();
      if (!value) throw new BadRequestException(`${key} is required for this upload`);
      cleanScope[key] = value;
    }
    if (cleanScope.carpenterId) {
      const exists = await this.prisma.carpenter.findUnique({ where: { id: cleanScope.carpenterId }, select: { id: true } });
      if (!exists) throw new NotFoundException('Carpenter not found');
    }
    const cleanOptions = Object.fromEntries(Object.entries(options ?? {}).filter(([, v]) => typeof v === 'boolean'));
    const ctx: ImportContext = { userId: user.userId, role: user.role, options: cleanOptions, scope: cleanScope };
    return { handler, ctx };
  }

  // 'existing' when the record a row would create is already in the
  // database, 'batch' when an earlier row of the same batch is the same
  // record (lines of one order don't count against each other).
  private async findDuplicates(handler: ImportHandler, rows: GridRow[], ctx: ImportContext): Promise<DuplicateKind[]> {
    const existing = await handler.existingKeys(rows, ctx);
    const seen = new Map<string, string>();
    return rows.map((row, i) => {
      const key = handler.duplicateKey(row, rows, ctx);
      if (!key) return null;
      if (existing.has(key)) return 'existing';
      const group = handler.groupKey ? handler.groupKey(row) : `#${i}`;
      const firstGroup = seen.get(key);
      if (firstGroup === undefined) {
        seen.set(key, group);
        return null;
      }
      return firstGroup === group ? null : 'batch';
    });
  }

  async preview(kind: string, file: UploadedSheet, user: { userId: string; role: Role }, scope: Record<string, string>) {
    const { handler, ctx } = await this.open(kind, user, scope);
    const table = await readTable(file, handler.spec);
    if (table.rows.length === 0) throw new BadRequestException('No rows found in this file.');
    if (table.rows.length > MAX_ROWS) throw new BadRequestException(`This file has more than ${MAX_ROWS} rows - split it into smaller files.`);

    const rows = await handler.preview(table.rows, ctx);
    const flags = await this.findDuplicates(handler, rows.map((r) => r.values), ctx);
    const out = rows.map((r, i) => ({ ...r, duplicate: flags[i] }));
    return {
      fileName: file.originalname,
      rows: out,
      sheetGrandTotal: table.grandTotal,
      parsedTotal: out.reduce((s, r) => s + handler.rowTotal(r.values), 0),
      duplicateCount: out.filter((r) => r.duplicate).length,
    };
  }

  // Same duplicate check for rows typed by hand into the grid - run before
  // saving so they're flagged exactly like uploaded rows.
  async check(kind: string, items: GridRow[], user: { userId: string; role: Role }, scope: Record<string, string>) {
    const { handler, ctx } = await this.open(kind, user, scope);
    const rows = sanitize(items);
    return { duplicates: await this.findDuplicates(handler, rows, ctx) };
  }

  // Saves the reviewed rows. Rows that are duplicates are refused unless
  // their index is in `confirmDuplicates` (the user pressed "Save anyway")
  // - checked here on the server, so a duplicate can't slip in however the
  // rows were entered.
  async commit(
    kind: string,
    body: { items: GridRow[]; confirmDuplicates?: number[]; options?: Record<string, boolean>; sourceFileName?: string },
    user: { userId: string; role: Role },
    scope: Record<string, string>,
  ) {
    const { handler, ctx } = await this.open(kind, user, scope, body.options ?? {});
    const rows = sanitize(body.items);
    if (rows.length === 0) throw new BadRequestException('Nothing to save.');
    if (rows.length > MAX_ROWS) throw new BadRequestException(`At most ${MAX_ROWS} rows per save.`);

    const confirmed = new Set(body.confirmDuplicates ?? []);
    const flags = await this.findDuplicates(handler, rows, ctx);
    const results: CommitResult[] = new Array(rows.length);
    const toSave: number[] = [];
    flags.forEach((flag, i) => {
      if (flag && !confirmed.has(i)) {
        results[i] = { ok: false, error: flag === 'existing' ? 'Already recorded - untick it, or confirm "Save anyway"' : 'Same as another row in this list - untick it, or confirm "Save anyway"' };
      } else {
        toSave.push(i);
      }
    });

    if (toSave.length) {
      const saved = await handler.commit(
        toSave.map((i) => rows[i]),
        ctx,
      );
      saved.forEach((r, j) => (results[toSave[j]] = r));
    }

    const created = results.filter((r) => r.ok).length;
    const total = rows.reduce((s, r, i) => s + (results[i].ok ? handler.rowTotal(r) : 0), 0);
    await this.audit.log({
      userId: user.userId,
      action: 'BULK_IMPORT',
      targetType: kind,
      targetId: ctx.scope.carpenterId ?? kind,
      metadata: {
        kind,
        sourceFileName: body.sourceFileName ?? null,
        rows: rows.length,
        saved: created,
        failed: rows.length - created,
        total,
        confirmedDuplicates: [...confirmed].length,
        options: ctx.options,
      },
    });
    return { created, failed: rows.length - created, total, results };
  }
}

// Grid rows arrive as plain JSON - keep only string-valued fields.
function sanitize(items: unknown[]): GridRow[] {
  return (items ?? []).map((item) => {
    const row: GridRow = {};
    if (item && typeof item === 'object') {
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        if (typeof v === 'string') row[k] = v;
        else if (typeof v === 'number' && Number.isFinite(v)) row[k] = String(v);
      }
    }
    return row;
  });
}
