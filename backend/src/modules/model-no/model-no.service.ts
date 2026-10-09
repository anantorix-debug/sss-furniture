import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../../common/enums/role.enum';
import { cleanModelNo, extractModelNumber, isJobNumber, modelNoKey, nameKey, sameDesign, validateModelNo } from '../../common/utils/model-no.util';
import { withNumericPrices } from '../../common/utils/product-prices.util';

type Db = PrismaService | Prisma.TransactionClient;

export type ModelNoStatus = 'FOUND' | 'HISTORY_ONLY' | 'NOT_FOUND' | 'INVALID';

export interface ModelNoAutofill {
  productName?: string;
  category?: string;
  size?: string;
  sizeUnit?: string;
  color?: string;
  pattern?: string;
  details?: string;
  // Catalogue (retail) price - never the worker rate, and left out entirely
  // for Carpenter / Carving / Polish viewers.
  unitPrice?: number;
}

export interface ModelNoLookupResult {
  modelNo: string;
  status: ModelNoStatus;
  message: string;
  product: Record<string, unknown> | null;
  autofill: ModelNoAutofill | null;
  stock: { quantity: number; availableQuantity: number; reservedQuantity: number } | null;
  history: { entries: number; lastWorkDate: string | null; names: string[]; conflict: boolean } | null;
}

// The ONE place that answers "what is Model No X?" for every page, form,
// import and production path, and the one place that may create a catalogue
// product from a Model No. Everything here is read-only except
// ensureCatalogProduct(), which never touches stock quantities.
@Injectable()
export class ModelNoService {
  constructor(private prisma: PrismaService) {}

  // --- normalization -------------------------------------------------------

  // For writers: a clean Model No or a 400 with a clear message.
  requireClean(raw: unknown): string {
    const v = validateModelNo(raw);
    if (!v.ok) throw new BadRequestException(v.reason);
    return v.value;
  }

  // For records that already exist (legacy text, Job Nos): the number if there is one, else nothing - never throws.
  lenient(raw: unknown): string | undefined {
    return extractModelNumber(raw) ?? undefined;
  }

  // Order-level Model No fields can hold several numbers ("12, 13" for a
  // multi-piece order). Each number is cleaned on its own ("PO-12, CO-13" ->
  // "12, 13"), repeats are dropped, and a Job No in the list is kept as is.
  requireCleanList(raw: unknown): string {
    const parts = cleanModelNo(raw).split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) throw new BadRequestException('Enter a Model No.');
    const out: string[] = [];
    for (const part of parts) {
      const value = isJobNumber(part) ? part : this.requireClean(part);
      if (!out.some((o) => modelNoKey(o) === modelNoKey(value))) out.push(value);
    }
    return out.join(', ');
  }

  optionalCleanList(raw: unknown): string | undefined {
    return raw == null || cleanModelNo(raw) === '' ? undefined : this.requireCleanList(raw);
  }

  // For optional fields: undefined when nothing was entered, else clean/400.
  optionalClean(raw: unknown): string | undefined {
    if (raw == null || cleanModelNo(raw) === '') return undefined;
    return this.requireClean(raw);
  }

  // --- reads ---------------------------------------------------------------

  // The values a stored Model No could be spelled as: the number itself,
  // plus the typed text for rows saved before Model Nos became number-only
  // (the one-time sync rewrites those; until then they still match).
  private spellings(raw: unknown): string[] {
    const number = extractModelNumber(raw);
    const typed = cleanModelNo(raw);
    return number ? [...new Set([number, typed])] : [];
  }

  // A Job No ("JOB-2026-00008") or text with no number is not a Model No and
  // matches nothing. The column is case-insensitive (utf8mb4_unicode_ci).
  async findProduct(raw: unknown, db: Db = this.prisma): Promise<Product | null> {
    const spellings = this.spellings(raw);
    if (spellings.length === 0) return null;
    const rows = await db.product.findMany({ where: { modelNo: { in: spellings } } });
    // the canonical spelling wins if both somehow exist
    return rows.find((r) => r.modelNo === spellings[0]) ?? rows[0] ?? null;
  }

  async findProductId(raw: unknown, db: Db = this.prisma): Promise<string | null> {
    return (await this.findProduct(raw, db))?.id ?? null;
  }

  // Many Model Nos at once (imports) -> Map keyed by modelNoKey().
  async findProducts(rawModelNos: unknown[], db: Db = this.prisma): Promise<Map<string, Product>> {
    const wanted = [...new Set(rawModelNos.flatMap((r) => this.spellings(r)))];
    if (wanted.length === 0) return new Map();
    const found = await db.product.findMany({ where: { modelNo: { in: wanted } } });
    return new Map(found.filter((p) => p.modelNo).map((p) => [modelNoKey(p.modelNo), p]));
  }

  private async history(modelNo: string, typed: string) {
    const where = { modelNo: { in: [...new Set([modelNo, typed])] } };
    const [entries, rows] = await Promise.all([
      this.prisma.carpenterWorkItem.count({ where }),
      this.prisma.carpenterWorkItem.findMany({
        where,
        orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
        take: 100,
        select: { productName: true, category: true, size: true, sizeUnit: true, color: true, workDate: true },
      }),
    ]);
    if (entries === 0) return null;
    const names: string[] = [];
    for (const r of rows) if (r.productName && !names.some((n) => nameKey(n) === nameKey(r.productName))) names.push(r.productName);
    // Conflict = the same Model No was written against genuinely different
    // designs (not just spelling variants of one).
    const conflict = names.some((a, i) => names.slice(i + 1).some((b) => !sameDesign(a, b)));
    return { entries, rows, names, conflict };
  }

  async lookup(raw: unknown, viewerRole?: Role): Promise<ModelNoLookupResult> {
    const v = validateModelNo(raw);
    if (!v.ok) {
      return { modelNo: cleanModelNo(raw), status: 'INVALID', message: v.reason, product: null, autofill: null, stock: null, history: null };
    }
    const modelNo = v.value;
    const typed = cleanModelNo(raw);
    const reduced = typed !== modelNo ? ` (using the number ${modelNo})` : '';
    const found = await this.findProduct(typed);
    const [product, history] = await Promise.all([
      found ? this.prisma.product.findUnique({ where: { id: found.id }, include: { images: { orderBy: { isPrimary: 'desc' } } } }) : Promise.resolve(null),
      this.history(modelNo, typed),
    ]);
    const historyOut = history
      ? { entries: history.entries, lastWorkDate: history.rows[0]?.workDate?.toISOString().slice(0, 10) ?? null, names: history.names, conflict: history.conflict }
      : null;

    if (product) {
      const shaped = withNumericPrices(product, viewerRole) as Record<string, unknown>;
      const autofill: ModelNoAutofill = {
        productName: product.name,
        category: product.category ?? undefined,
        size: product.modelSize ?? undefined,
        sizeUnit: product.sizeUnit ?? undefined,
        color: product.materialFinish ?? undefined,
        pattern: product.pattern ?? undefined,
        details: product.details ?? undefined,
        ...(typeof shaped.retailPrice === 'number' ? { unitPrice: shaped.retailPrice } : {}),
      };
      const inStock = product.availableQuantity > 0;
      return {
        modelNo,
        status: 'FOUND',
        message: `Found in inventory${reduced}: ${product.name}${product.category ? ` - ${product.category}` : ''}${product.modelSize ? ` - ${product.modelSize}` : ''} (${inStock ? 'in stock' : 'no stock'}).`,
        product: shaped,
        autofill,
        stock: { quantity: product.quantity, availableQuantity: product.availableQuantity, reservedQuantity: product.reservedQuantity },
        history: historyOut,
      };
    }

    if (history) {
      const latest = history.rows[0];
      return {
        modelNo,
        status: 'HISTORY_ONLY',
        message: `Not in inventory yet${reduced}. Seen in ${history.entries} production ${history.entries === 1 ? 'entry' : 'entries'} as "${latest.productName}"${history.conflict ? ' and other designs - please check' : ''}.`,
        product: null,
        autofill: {
          productName: latest.productName,
          category: latest.category ?? undefined,
          size: latest.size ?? undefined,
          sizeUnit: latest.sizeUnit ?? undefined,
          color: latest.color ?? undefined,
        },
        stock: null,
        history: historyOut,
      };
    }

    return {
      modelNo,
      status: 'NOT_FOUND',
      message: `Model No ${modelNo} was not found in inventory or production history - it will be treated as a new Model No.`,
      product: null,
      autofill: null,
      stock: null,
      history: null,
    };
  }

  // --- writes --------------------------------------------------------------

  // Throws a clear 409 when ANOTHER product already owns this Model No -
  // used before any write that would put a Model No on a product, so the
  // user gets a message instead of a database error.
  async assertFree(raw: unknown, exceptProductId?: string, db: Db = this.prisma): Promise<void> {
    const spellings = this.spellings(raw);
    if (spellings.length === 0) return;
    const modelNo = spellings[0];
    const owner = await db.product.findFirst({ where: { modelNo: { in: spellings }, ...(exceptProductId ? { id: { not: exceptProductId } } : {}) } });
    if (owner) {
      throw new ConflictException(`Model No ${modelNo} already belongs to "${owner.name}" in inventory - use that product instead of creating another.`);
    }
  }

  // For production records. Returns the Model No to store and the product it
  // belongs to (null when no product has it - nothing is created here).
  // A Job No sitting in the field is kept exactly as it is and links to
  // nothing; anything else must be a number. A product link already given by
  // the caller (a chosen template/design) is respected.
  async forWorkItem(raw: unknown, givenProductId?: string | null, db: Db = this.prisma): Promise<{ modelNo: string | undefined; productId: string | null }> {
    if (raw == null || cleanModelNo(raw) === '') return { modelNo: undefined, productId: givenProductId ?? null };
    if (isJobNumber(raw)) return { modelNo: cleanModelNo(raw), productId: givenProductId ?? null };
    const modelNo = this.requireClean(raw);
    if (givenProductId) return { modelNo, productId: givenProductId };
    return { modelNo, productId: await this.findProductId(modelNo, db) };
  }

  // Race-safe "register this Model No as a catalogue product if it isn't
  // one yet" - for forms that explicitly register a brand-new product (the
  // Customer / Party Order lines). It NEVER sets stock (quantity stays 0)
  // and never overwrites an existing product's details. Two simultaneous
  // calls for the same new Model No both end up with the same row: the
  // unique index lets exactly one insert win and the other reads it back.
  async ensureCatalogProduct(
    data: {
      modelNo: string;
      name: string;
      category?: string | null;
      modelSize?: string | null;
      sizeUnit?: string | null;
      materialFinish?: string | null;
      pattern?: string | null;
      details?: string | null;
      retailPrice?: number | string | null;
      unit?: string | null;
    },
    db: Db = this.prisma,
  ): Promise<{ product: Product; created: boolean }> {
    const modelNo = this.requireClean(data.modelNo);
    const existing = await this.findProduct(modelNo, db);
    if (existing) return { product: existing, created: false };
    try {
      const product = await db.product.create({
        data: {
          modelNo,
          name: data.name?.trim() || `Model ${modelNo}`,
          category: data.category || undefined,
          modelSize: data.modelSize || undefined,
          sizeUnit: data.sizeUnit || undefined,
          materialFinish: data.materialFinish || undefined,
          pattern: data.pattern || undefined,
          details: data.details || undefined,
          retailPrice: data.retailPrice != null && Number.isFinite(Number(data.retailPrice)) ? Number(data.retailPrice) : 0,
          unit: data.unit || 'Nos',
          quantity: 0,
          availableQuantity: 0,
          reservedQuantity: 0,
        },
      });
      return { product, created: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const winner = await this.findProduct(modelNo, db);
        if (winner) return { product: winner, created: false };
      }
      throw e;
    }
  }
}
