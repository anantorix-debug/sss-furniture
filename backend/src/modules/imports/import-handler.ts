import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { clean, parseAmount, parseSheetDate, TableSpec } from '../../common/import/sheet-reader';
import { Role } from '../../common/enums/role.enum';

// One bulk-upload "kind" (customer orders, expenses, ...). Each kind knows
// three things: which sheet columns it reads (spec), how a sheet row becomes
// an editable grid row (preview - no writes), and how reviewed grid rows are
// saved (commit - always through the page's own existing service, so job
// numbers, voucher numbers, stock allocation and audit logs behave exactly
// like a manual entry).
//
// Grid rows are plain string records keyed by column - the same shape the
// browser edits - and are converted/validated again on commit, never
// trusted as-is.

export type GridRow = Record<string, string>;

export interface ImportContext {
  userId: string;
  role: Role;
  options: Record<string, boolean>;
  // Which record the page is scoped to, e.g. { carpenterId } on a worker
  // page. Empty for page-wide imports.
  scope: Record<string, string>;
}

// What a kind returns for one sheet row - duplicate flags are added by
// ImportsService, the same way for every kind.
// What the central Model No lookup said about a row's Model No (kinds that
// have a Model No column): FOUND = already a product in inventory, NEW = a
// number nobody has used yet. Purely informational - nothing is created.
export interface RowLookup {
  status: 'FOUND' | 'NEW';
  productId?: string;
  name?: string;
  inStock?: boolean;
}

export interface HandlerPreviewRow {
  line: number;
  values: GridRow;
  warnings: string[];
  lookup?: RowLookup;
}

// 'existing' = already recorded in the database; 'batch' = repeats another
// row of this same upload/grid.
export type DuplicateKind = 'existing' | 'batch' | null;

export interface PreviewRow extends HandlerPreviewRow {
  duplicate: DuplicateKind;
}

export interface CommitResult {
  ok: boolean;
  error?: string;
}

export interface ImportHandler {
  readonly kind: string;
  // Lowest role allowed - the same role the page's own "create" needs.
  readonly minRole: Role.ADMIN | Role.SUPERADMIN;
  readonly spec: TableSpec<string>;
  // Scope keys this kind needs (e.g. ['carpenterId']).
  readonly requiredScope?: string[];
  // Name of the grid column that holds a Model No, when the kind has one -
  // the upload then runs every row through the central Model No lookup.
  readonly modelNoField?: string;
  // Fill blank category/size/name from the matching inventory product. Off
  // for kinds whose rows ARE the product list.
  readonly autofillFromProduct?: boolean;
  preview(rows: { line: number; cells: Partial<Record<string, string>> }[], ctx: ImportContext): Promise<HandlerPreviewRow[]>;
  // One result per item, in the same order. Only ever called with rows that
  // passed the duplicate check (or that the user confirmed).
  commit(items: GridRow[], ctx: ImportContext): Promise<CommitResult[]>;
  rowTotal(values: GridRow): number;
  // Identity of the record a row would create, for "already recorded"
  // checks - null when a row can't be identified yet (e.g. no date).
  // `all` is passed for kinds whose identity is per order (shop + date +
  // the whole order's total).
  duplicateKey(row: GridRow, all: GridRow[], ctx: ImportContext): string | null;
  // Identities already in the database, for the rows given.
  existingKeys(rows: GridRow[], ctx: ImportContext): Promise<Set<string>>;
  // Grouped kinds (orders): lines of one order share this, so they aren't
  // flagged as repeats of each other.
  groupKey?(row: GridRow): string;
}

// Sum of a grouped row's whole group (e.g. an order's total), by groupKey.
export function groupTotal(row: GridRow, all: GridRow[], groupOf: (r: GridRow) => string, totalOf: (r: GridRow) => number): number {
  const g = groupOf(row);
  return all.filter((r) => groupOf(r) === g).reduce((s, r) => s + totalOf(r), 0);
}

// --- small helpers shared by the kinds -------------------------------------

export const text = (cells: Partial<Record<string, string>>, key: string) => clean(cells[key]);

export const num = (v: string | undefined): number | null => (v == null ? null : parseAmount(v));

// Grid numbers come back as plain strings ("1600", "") - '' means "not set".
export const gridNum = (v: string | undefined): number | undefined => {
  const n = num(v ?? '');
  return n == null ? undefined : n;
};

export const blankToUndef = (v: string | undefined) => {
  const t = (v ?? '').trim();
  return t ? t : undefined;
};

export function sheetDate(raw: string, label: string, warnings: string[]): string {
  if (!raw) {
    warnings.push(`${label} is missing`);
    return '';
  }
  const d = parseSheetDate(raw);
  if (!d) warnings.push(`${label} "${raw}" not recognised`);
  return d ?? '';
}

// Upper-case, letters and digits only - "Devi Ply-Wood " == "DEVI PLYWOOD".
export const normName = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Exact (normalised) name match against a lookup list; '' + a warning when
// the name is unknown, so the grid shows the select empty and flagged.
export function matchByName(list: { id: string; name: string }[], raw: string, what: string, warnings: string[], hint: string): string {
  if (!raw) return '';
  const hit = list.find((x) => normName(x.name) === normName(raw));
  if (!hit) warnings.push(`${what} "${raw}" not found - ${hint}`);
  return hit?.id ?? '';
}

export const day = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

export function errorMessage(e: unknown): string {
  if (e instanceof HttpException) {
    const res = e.getResponse() as { message?: string | string[] } | string;
    const m = typeof res === 'string' ? res : res.message;
    return Array.isArray(m) ? m.join(', ') : (m ?? e.message);
  }
  return e instanceof Error ? e.message : 'Failed to save';
}

// Runs the page's own DTO validation (the same class-validator rules the
// normal create endpoint applies) on an object built from a grid row.
export async function validateAs<T extends object>(cls: new () => T, plain: object): Promise<{ dto: T; errors: string[] }> {
  const dto = plainToInstance(cls, plain);
  const errs = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, errors: flatten(errs) };
}

function flatten(errs: ValidationError[], prefix = ''): string[] {
  return errs.flatMap((e) => {
    const path = prefix ? `${prefix}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((m) => m.replace(e.property, path));
    return [...own, ...flatten(e.children ?? [], path)];
  });
}

// Orders arrive as one grid row per product line; lines sharing a group key
// become one order. Each group is created once and its result is copied to
// every one of its lines, so the grid can mark them together.
export async function commitGrouped(items: GridRow[], keyOf: (row: GridRow) => string, create: (lines: GridRow[]) => Promise<void>): Promise<CommitResult[]> {
  const groups = new Map<string, number[]>();
  items.forEach((row, i) => {
    const k = keyOf(row) || `#${i}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  const results: CommitResult[] = new Array(items.length);
  for (const idx of groups.values()) {
    let result: CommitResult;
    try {
      await create(idx.map((i) => items[i]));
      result = { ok: true };
    } catch (e) {
      result = { ok: false, error: errorMessage(e) };
    }
    for (const i of idx) results[i] = result;
  }
  return results;
}

// One row = one record: each row is saved on its own and a failure doesn't
// stop the rest.
export async function commitEach(items: GridRow[], create: (row: GridRow) => Promise<void>): Promise<CommitResult[]> {
  const results: CommitResult[] = [];
  for (const row of items) {
    try {
      await create(row);
      results.push({ ok: true });
    } catch (e) {
      results.push({ ok: false, error: errorMessage(e) });
    }
  }
  return results;
}

// A row whose DTO failed validation - thrown so commitEach/commitGrouped
// report it on that row.
export class RowInvalidError extends HttpException {
  constructor(errors: string[]) {
    super({ message: errors.join(', ') }, 400);
  }
}

export async function validOrThrow<T extends object>(cls: new () => T, plain: object): Promise<T> {
  const { dto, errors } = await validateAs(cls, plain);
  if (errors.length) throw new RowInvalidError(errors);
  return dto;
}
