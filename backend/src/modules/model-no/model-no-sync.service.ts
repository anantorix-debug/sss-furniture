import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ModelNoService } from './model-no.service';
import { cleanModelNo, extractModelNumber, isCanonicalModelNo, isJobNumber, sameDesign, validateModelNo } from '../../common/utils/model-no.util';

export interface SyncOptions {
  // false (default) = report only, nothing is written.
  apply?: boolean;
  // true = also register a catalogue master (quantity 0) for a Model No that
  // has production history but no product, when the history agrees on one
  // design. Off by default: retail price is unknown, so such a master has
  // price 0 until someone sets it.
  createMissing?: boolean;
}

interface ReviewItem {
  kind: 'WORK_ITEM' | 'PARTY_ORDER_ITEM' | 'PRODUCT';
  id: string;
  modelNo: string;
  recordName: string;
  productName?: string;
  reason: string;
}

type ProductRow = {
  id: string;
  name: string;
  modelNo: string | null;
  quantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  createdAt: Date;
};

export interface SyncReport {
  mode: 'DRY_RUN' | 'APPLIED';
  createMissing: boolean;
  generatedAt: string;
  products: { total: number; withModelNo: number; renamedToNumber: number; untrimmed: number };
  numberOnly: {
    // Model Nos that carried prefix text and are reduced to the number.
    changed: { table: string; from: string; to: string; count: number }[];
    totalRewritten: number;
    // Job Nos kept in a Model No field - left exactly as they are.
    jobNumbersLeftAlone: string[];
    // Text with no number in it - left as is, listed for review.
    notAModelNo: string[];
  };
  merges: {
    groups: { modelNo: string; kept: { id: string; name: string; modelNo: string | null }; merged: { id: string; name: string; modelNo: string | null; moved: Record<string, number> }[] }[];
    merged: number;
    blocked: { modelNo: string; reason: string; products: { id: string; name: string; modelNo: string | null; quantity: number }[] }[];
  };
  workItems: { total: number; withModelNo: number; withoutModelNo: number; alreadyLinked: number; matched: number; linked: number; needsReview: number; noProductMaster: number };
  partyOrderItems: { withModelNo: number; alreadyLinked: number; matched: number; linked: number; needsReview: number; noProductMaster: number };
  newProducts: { created: number; list: { modelNo: string; name: string }[] };
  missingMasters: { modelNo: string; entries: number; names: string[]; category: string | null; size: string | null; firstDate: string | null; lastDate: string | null; canCreate: boolean; reason?: string }[];
  historyConflicts: { modelNo: string; names: string[]; entries: number }[];
  missingModelNo: { count: number; sample: { id: string; productName: string; workDate: string; entryType: string }[] };
  manualReview: ReviewItem[];
  stock: { unchanged: boolean; stockTotalsBefore: StockTotals; stockTotalsAfter: StockTotals; movementsBefore: number; movementsAfter: number };
}

interface StockTotals {
  quantity: number;
  available: number;
  reserved: number;
}

const REVIEW_CAP = 300;
const MISSING_CAP = 600;

// One-time (and safely repeatable) clean-up and synchronization of Model Nos
// across the application:
//   1. Model Nos become the number only ("PO-NEW-2" -> "2"). Products that
//      end up with the same number are MERGED into one - every order line,
//      work item, stock movement, image and finished-stock row is moved to
//      the kept product first, so no history is lost.
//   2. Production records and party order lines are LINKED to the product
//      with their Model No.
// It never changes a stock quantity, never writes a stock movement, never
// deletes a production record, and never overwrites an existing link. What
// it can't decide - differing names, two real pieces with one number, one
// number used for different designs - is listed for a person to review.
@Injectable()
export class ModelNoSyncService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private modelNos: ModelNoService,
  ) {}

  private async stockTotals(): Promise<{ totals: StockTotals; movements: number }> {
    const [agg, movements] = await Promise.all([
      this.prisma.product.aggregate({ _sum: { quantity: true, availableQuantity: true, reservedQuantity: true } }),
      this.prisma.productStockMovement.count(),
    ]);
    return { totals: { quantity: agg._sum.quantity ?? 0, available: agg._sum.availableQuantity ?? 0, reserved: agg._sum.reservedQuantity ?? 0 }, movements };
  }

  // Which of several products sharing one number is kept: a real physical
  // piece first (it carries the stock), then one already spelled as a plain
  // number, then the one with the most history behind it, then the oldest.
  private pickSurvivor(group: ProductRow[], refs: Map<string, number>): ProductRow {
    return [...group].sort(
      (a, b) =>
        Number(b.quantity > 0) - Number(a.quantity > 0) ||
        Number(isCanonicalModelNo(b.modelNo)) - Number(isCanonicalModelNo(a.modelNo)) ||
        (refs.get(b.id) ?? 0) - (refs.get(a.id) ?? 0) ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    )[0];
  }

  async run(options: SyncOptions, userId: string): Promise<SyncReport> {
    const apply = options.apply === true;
    const createMissing = options.createMissing === true;
    const before = await this.stockTotals();

    const [products, workItems, partyItems, partyOrders] = await Promise.all([
      this.prisma.product.findMany({ select: { id: true, name: true, modelNo: true, quantity: true, availableQuantity: true, reservedQuantity: true, createdAt: true } }),
      this.prisma.carpenterWorkItem.findMany({
        select: { id: true, modelNo: true, productId: true, productName: true, category: true, size: true, sizeUnit: true, color: true, workDate: true, entryType: true },
        orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.partyOrderItem.findMany({ where: { modelNo: { not: null } }, select: { id: true, modelNo: true, productId: true, productName: true } }),
      this.prisma.partyOrder.findMany({ where: { cotNo: { not: null } }, select: { id: true, cotNo: true } }),
    ]);

    // How much history hangs off each product (used to pick the one to keep).
    const [woRefs, ciRefs, piRefs, smRefs] = await Promise.all([
      this.prisma.carpenterWorkItem.groupBy({ by: ['productId'], where: { productId: { not: null } }, _count: true }),
      this.prisma.customerOrderItem.groupBy({ by: ['productId'], where: { productId: { not: null } }, _count: true }),
      this.prisma.partyOrderItem.groupBy({ by: ['productId'], where: { productId: { not: null } }, _count: true }),
      this.prisma.productStockMovement.groupBy({ by: ['productId'], _count: true }),
    ]);
    const refs = new Map<string, number>();
    for (const list of [woRefs, ciRefs, piRefs, smRefs]) for (const r of list) if (r.productId) refs.set(r.productId, (refs.get(r.productId) ?? 0) + (r._count as number));

    const review: ReviewItem[] = [];
    const addReview = (r: ReviewItem) => {
      if (review.length < REVIEW_CAP) review.push(r);
    };

    // --- 1. Number-only: what changes, what is left alone ---------------------
    const changeCounts = new Map<string, { table: string; from: string; to: string; count: number }>();
    const noteChange = (table: string, from: string, to: string) => {
      const k = `${table}|${from}`;
      const cur = changeCounts.get(k) ?? { table, from, to, count: 0 };
      cur.count++;
      changeCounts.set(k, cur);
    };
    const jobNumbers = new Set<string>();
    const notAModelNo = new Set<string>();
    const classify = (table: string, raw: string | null): string | null => {
      const text = cleanModelNo(raw);
      if (!text) return null;
      if (isJobNumber(text)) {
        jobNumbers.add(text);
        return null;
      }
      if (text.includes(',')) return null; // a list of several Model Nos on one order line - not edited
      const number = extractModelNumber(text);
      if (!number) {
        notAModelNo.add(text);
        return null;
      }
      if (text !== number) noteChange(table, text, number);
      return number;
    };

    // --- 2. Product masters: group by number, decide merges --------------------
    const groups = new Map<string, ProductRow[]>();
    let untrimmed = 0;
    for (const p of products) {
      if (!p.modelNo || !cleanModelNo(p.modelNo)) continue;
      if (p.modelNo !== cleanModelNo(p.modelNo)) untrimmed++;
      const number = classify('products', p.modelNo);
      if (!number) continue;
      groups.set(number, [...(groups.get(number) ?? []), p]);
    }
    const byKey = new Map<string, ProductRow>(); // number -> the product that stays
    const mergePlans: { number: string; kept: ProductRow; losers: ProductRow[] }[] = [];
    const blocked: SyncReport['merges']['blocked'] = [];
    for (const [number, group] of groups) {
      if (group.length === 1) {
        byKey.set(number, group[0]);
        continue;
      }
      const withStock = group.filter((p) => p.quantity > 0);
      if (withStock.length > 1) {
        // Two real pieces share one number - that is a data problem, not a duplicate.
        blocked.push({ modelNo: number, reason: 'More than one of these products has real stock - decide which piece is right before merging', products: group.map((p) => ({ id: p.id, name: p.name, modelNo: p.modelNo, quantity: p.quantity })) });
        for (const p of group) addReview({ kind: 'PRODUCT', id: p.id, modelNo: number, recordName: p.name, reason: 'Shares its Model No with another product that also has stock' });
        continue;
      }
      const kept = this.pickSurvivor(group, refs);
      byKey.set(number, kept);
      mergePlans.push({ number, kept, losers: group.filter((p) => p.id !== kept.id) });
    }
    const mergedAway = new Set(mergePlans.flatMap((m) => m.losers.map((l) => l.id)));
    const blockedNumbers = new Set(blocked.map((b) => b.modelNo));

    // --- 3. Production work items ----------------------------------------------
    const wi = { total: workItems.length, withModelNo: 0, withoutModelNo: 0, alreadyLinked: 0, matched: 0, linked: 0, needsReview: 0, noProductMaster: 0 };
    const linkPlan = new Map<string, string[]>(); // productId -> work item ids
    const workRewrites = new Map<string, string[]>(); // number -> ids whose text changes
    const missing = new Map<string, typeof workItems>();
    const missingNoModel: typeof workItems = [];
    for (const w of workItems) {
      const text = cleanModelNo(w.modelNo);
      if (!text) {
        wi.withoutModelNo++;
        missingNoModel.push(w);
        continue;
      }
      wi.withModelNo++;
      const number = classify('work items', w.modelNo);
      if (number && w.modelNo !== number) workRewrites.set(number, [...(workRewrites.get(number) ?? []), w.id]);
      if (!number) continue; // job number / free text: stays as it is, never linked
      if (w.productId && !mergedAway.has(w.productId)) {
        wi.alreadyLinked++;
        continue;
      }
      const master = byKey.get(number);
      if (!master && blockedNumbers.has(number)) {
        wi.needsReview++;
        addReview({ kind: 'WORK_ITEM', id: w.id, modelNo: number, recordName: w.productName, reason: 'Several products share this Model No - resolve them first' });
        continue;
      }
      if (!master) {
        wi.noProductMaster++;
        missing.set(number, [...(missing.get(number) ?? []), w]);
        continue;
      }
      if (w.productId && mergedAway.has(w.productId)) continue; // repointed by the merge itself
      if (!sameDesign(w.productName, master.name)) {
        wi.needsReview++;
        addReview({ kind: 'WORK_ITEM', id: w.id, modelNo: number, recordName: w.productName, productName: master.name, reason: 'Product name differs from the inventory product with this Model No' });
        continue;
      }
      wi.matched++;
      linkPlan.set(master.id, [...(linkPlan.get(master.id) ?? []), w.id]);
    }

    // --- 4. Party order lines / order headers ---------------------------------
    const pi = { withModelNo: 0, alreadyLinked: 0, matched: 0, linked: 0, needsReview: 0, noProductMaster: 0 };
    const partyPlan = new Map<string, string[]>();
    const partyRewrites = new Map<string, string[]>();
    for (const it of partyItems) {
      pi.withModelNo++;
      const number = classify('party order lines', it.modelNo);
      if (!number) continue;
      if (it.modelNo !== number) partyRewrites.set(number, [...(partyRewrites.get(number) ?? []), it.id]);
      if (it.productId && !mergedAway.has(it.productId)) {
        pi.alreadyLinked++;
        continue;
      }
      const master = byKey.get(number);
      if (!master && blockedNumbers.has(number)) {
        pi.needsReview++;
        addReview({ kind: 'PARTY_ORDER_ITEM', id: it.id, modelNo: number, recordName: it.productName, reason: 'Several products share this Model No - resolve them first' });
        continue;
      }
      if (!master) {
        pi.noProductMaster++;
        continue;
      }
      if (it.productId && mergedAway.has(it.productId)) continue;
      if (!sameDesign(it.productName, master.name)) {
        pi.needsReview++;
        addReview({ kind: 'PARTY_ORDER_ITEM', id: it.id, modelNo: number, recordName: it.productName, productName: master.name, reason: 'Product name differs from the inventory product with this Model No' });
        continue;
      }
      pi.matched++;
      partyPlan.set(master.id, [...(partyPlan.get(master.id) ?? []), it.id]);
    }
    const cotRewrites = new Map<string, string[]>();
    for (const o of partyOrders) {
      const number = classify('party orders', o.cotNo);
      if (number && o.cotNo !== number) cotRewrites.set(number, [...(cotRewrites.get(number) ?? []), o.id]);
    }

    // --- 5. Model Nos with production history but no product master -----------
    const missingMasters: SyncReport['missingMasters'] = [];
    const historyConflicts: SyncReport['historyConflicts'] = [];
    const createPlan: { modelNo: string; name: string; category: string | null; size: string | null; sizeUnit: string | null; color: string | null; ids: string[] }[] = [];
    for (const [number, rows] of missing) {
      const names: string[] = [];
      for (const r of rows) if (!names.some((n) => sameDesign(n, r.productName))) names.push(r.productName);
      const conflict = names.length > 1;
      const valid = validateModelNo(number).ok;
      const latest = rows[0]; // newest first
      const dates = rows.map((r) => r.workDate.toISOString().slice(0, 10)).sort();
      const canCreate = valid && !conflict && !!latest.productName?.trim();
      let reason: string | undefined;
      if (!valid) reason = 'Not a valid Model No';
      else if (conflict) reason = 'The same Model No is used for different designs - decide which is right first';
      if (conflict) historyConflicts.push({ modelNo: number, names, entries: rows.length });
      if (missingMasters.length < MISSING_CAP) {
        missingMasters.push({ modelNo: number, entries: rows.length, names, category: latest.category ?? null, size: latest.size ?? null, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null, canCreate, reason });
      }
      if (conflict) for (const r of rows) addReview({ kind: 'WORK_ITEM', id: r.id, modelNo: number, recordName: r.productName, reason: 'Same Model No used for different designs' });
      if (canCreate && createMissing) {
        createPlan.push({ modelNo: number, name: latest.productName.trim(), category: latest.category ?? null, size: latest.size ?? null, sizeUnit: latest.sizeUnit ?? null, color: latest.color ?? null, ids: rows.map((r) => r.id) });
      }
    }

    // --- apply ---------------------------------------------------------------
    const newProducts: SyncReport['newProducts'] = { created: 0, list: [] };
    const mergeReport: SyncReport['merges']['groups'] = [];
    let renamedToNumber = 0;
    let totalRewritten = 0;

    // what a merge would move, for the report (dry run and apply alike)
    const countsFor = async (id: string, db: Prisma.TransactionClient | PrismaService) => ({
      images: await db.productImage.count({ where: { productId: id } }),
      customerOrderLines: await db.customerOrderItem.count({ where: { productId: id } }),
      partyOrders: await db.partyOrder.count({ where: { productId: id } }),
      partyOrderLines: await db.partyOrderItem.count({ where: { productId: id } }),
      workItems: await db.carpenterWorkItem.count({ where: { productId: id } }),
      stockMovements: await db.productStockMovement.count({ where: { productId: id } }),
      finishedStock: await db.finishedStockItem.count({ where: { productId: id } }),
    });

    for (const plan of mergePlans) {
      const entry = { modelNo: plan.number, kept: { id: plan.kept.id, name: plan.kept.name, modelNo: plan.kept.modelNo }, merged: [] as SyncReport['merges']['groups'][number]['merged'] };
      if (!apply) {
        for (const l of plan.losers) entry.merged.push({ id: l.id, name: l.name, modelNo: l.modelNo, moved: await countsFor(l.id, this.prisma) });
        mergeReport.push(entry);
        continue;
      }
      await this.prisma.$transaction(
        async (tx) => {
          for (const loser of plan.losers) {
            const moved = await countsFor(loser.id, tx);
            const to = plan.kept.id;
            const from = loser.id;
            const keptHasPrimary = (await tx.productImage.count({ where: { productId: to, isPrimary: true } })) > 0;
            if (keptHasPrimary) await tx.productImage.updateMany({ where: { productId: from }, data: { isPrimary: false } });
            await tx.productImage.updateMany({ where: { productId: from }, data: { productId: to } });
            await tx.customerOrderItem.updateMany({ where: { productId: from }, data: { productId: to } });
            await tx.partyOrder.updateMany({ where: { productId: from }, data: { productId: to } });
            await tx.partyOrderItem.updateMany({ where: { productId: from }, data: { productId: to } });
            await tx.carpenterWorkItem.updateMany({ where: { productId: from }, data: { productId: to } });
            await tx.productStockMovement.updateMany({ where: { productId: from }, data: { productId: to } });
            await tx.finishedStockItem.updateMany({ where: { productId: from }, data: { productId: to } });
            // fill blanks on the kept product from the duplicate, never overwrite
            const [k, l] = await Promise.all([tx.product.findUniqueOrThrow({ where: { id: to } }), tx.product.findUniqueOrThrow({ where: { id: from } })]);
            const fill = <T>(a: T | null, b: T | null) => (a == null || a === ('' as unknown as T) ? (b ?? undefined) : undefined);
            await tx.product.update({
              where: { id: to },
              data: {
                category: fill(k.category, l.category),
                modelSize: fill(k.modelSize, l.modelSize),
                materialFinish: fill(k.materialFinish, l.materialFinish),
                sizeUnit: fill(k.sizeUnit, l.sizeUnit),
                pattern: fill(k.pattern, l.pattern),
                details: fill(k.details, l.details),
                unit: fill(k.unit, l.unit),
                wholesalePrice: k.wholesalePrice == null ? (l.wholesalePrice ?? undefined) : undefined,
                costPrice: k.costPrice == null ? (l.costPrice ?? undefined) : undefined,
                retailPrice: Number(k.retailPrice) === 0 ? l.retailPrice : undefined,
              },
            });
            // a duplicate with real stock only reaches here when the kept product has none: it was ranked first
            await tx.product.delete({ where: { id: from } });
            entry.merged.push({ id: loser.id, name: loser.name, modelNo: loser.modelNo, moved });
          }
          await tx.product.update({ where: { id: plan.kept.id }, data: { modelNo: plan.number } });
        },
        { timeout: 30000 },
      );
      mergeReport.push(entry);
      await this.audit.log({
        userId,
        action: 'PRODUCTS_MERGED_BY_MODEL_NO',
        targetType: 'Product',
        targetId: plan.kept.id,
        metadata: { modelNo: plan.number, kept: entry.kept, merged: entry.merged },
      });
    }

    if (apply) {
      // products still spelled with prefix text (no duplicate to merge with)
      for (const [number, group] of groups) {
        if (group.length !== 1) continue;
        const only = group[0];
        if (only.modelNo !== number) {
          await this.prisma.product.update({ where: { id: only.id }, data: { modelNo: number } });
          renamedToNumber++;
        }
      }
      for (const [number, ids] of workRewrites) totalRewritten += (await this.prisma.carpenterWorkItem.updateMany({ where: { id: { in: ids } }, data: { modelNo: number } })).count;
      for (const [number, ids] of partyRewrites) totalRewritten += (await this.prisma.partyOrderItem.updateMany({ where: { id: { in: ids } }, data: { modelNo: number } })).count;
      for (const [number, ids] of cotRewrites) totalRewritten += (await this.prisma.partyOrder.updateMany({ where: { id: { in: ids } }, data: { cotNo: number } })).count;

      // Only ever fills a still-empty link, so re-running (or racing with a
      // user editing the same row) can't overwrite anything.
      for (const [productId, ids] of linkPlan) wi.linked += (await this.prisma.carpenterWorkItem.updateMany({ where: { id: { in: ids }, productId: null }, data: { productId } })).count;
      for (const [productId, ids] of partyPlan) pi.linked += (await this.prisma.partyOrderItem.updateMany({ where: { id: { in: ids }, productId: null }, data: { productId } })).count;
      for (const plan of createPlan) {
        // ensureCatalogProduct is the same race-safe, stock-free creation the
        // order forms use: quantity 0, never overwrites an existing row.
        const { product, created } = await this.modelNos.ensureCatalogProduct({
          modelNo: plan.modelNo,
          name: plan.name,
          category: plan.category,
          modelSize: plan.size,
          sizeUnit: plan.sizeUnit,
          materialFinish: plan.color,
          retailPrice: 0,
        });
        if (created) {
          newProducts.created++;
          if (newProducts.list.length < 100) newProducts.list.push({ modelNo: plan.modelNo, name: plan.name });
        }
        wi.linked += (await this.prisma.carpenterWorkItem.updateMany({ where: { id: { in: plan.ids }, productId: null }, data: { productId: product.id } })).count;
      }
    }

    const after = await this.stockTotals();
    const unchanged = JSON.stringify(before.totals) === JSON.stringify(after.totals) && before.movements === after.movements;
    const changed = [...changeCounts.values()].sort((a, b) => b.count - a.count || a.from.localeCompare(b.from));
    const report: SyncReport = {
      mode: apply ? 'APPLIED' : 'DRY_RUN',
      createMissing,
      generatedAt: new Date().toISOString(),
      products: { total: products.length, withModelNo: [...groups.values()].reduce((n, a) => n + a.length, 0), renamedToNumber, untrimmed },
      numberOnly: { changed: changed.slice(0, 200), totalRewritten, jobNumbersLeftAlone: [...jobNumbers].slice(0, 100), notAModelNo: [...notAModelNo].slice(0, 100) },
      merges: { groups: mergeReport, merged: mergeReport.reduce((n, g) => n + g.merged.length, 0), blocked },
      workItems: wi,
      partyOrderItems: pi,
      newProducts,
      missingMasters,
      historyConflicts,
      missingModelNo: {
        count: missingNoModel.length,
        sample: missingNoModel.slice(0, 50).map((w) => ({ id: w.id, productName: w.productName, workDate: w.workDate.toISOString().slice(0, 10), entryType: w.entryType })),
      },
      manualReview: review,
      stock: { unchanged, stockTotalsBefore: before.totals, stockTotalsAfter: after.totals, movementsBefore: before.movements, movementsAfter: after.movements },
    };
    if (apply) {
      await this.audit.log({
        userId,
        action: 'MODEL_NO_SYNC',
        targetType: 'Product',
        targetId: 'model-no-sync',
        metadata: {
          createMissing,
          productsMerged: report.merges.merged,
          productsRenamed: renamedToNumber,
          recordsRewritten: totalRewritten,
          workItemsLinked: wi.linked,
          partyItemsLinked: pi.linked,
          productsCreated: newProducts.created,
          needsReview: wi.needsReview + pi.needsReview + blocked.length,
          stockUnchanged: unchanged,
        },
      });
    }
    return report;
  }
}
