import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PdfService } from '../../pdf/pdf.service';
import { Role } from '../../../common/enums/role.enum';
import { sumAmounts } from '../../../common/utils/balance.util';
import { paginate, toSkipTake } from '../../../common/utils/pagination.util';
import { escapeHtml, REPORT_PDF_STYLES, renderReportHeader, renderFilterSummary, renderGeneratedFooter } from '../../../common/utils/pdf-report.util';
import { CreateRawMaterialDto } from './dto/create-raw-material.dto';
import { UpdateRawMaterialDto } from './dto/update-raw-material.dto';
import { StockInDto } from './dto/stock-in.dto';
import { StockAdjustmentDto } from './dto/stock-adjustment.dto';
import { IssueMaterialDto } from './dto/issue-material.dto';
import { computeBoardFeet } from '../../../common/utils/board-feet.util';

const REFERENCE_LABEL: Record<string, string> = {
  PURCHASE: 'Purchase',
  PRODUCTION: 'Production',
  ADJUSTMENT: 'Adjustment',
};

// Carpenter team only ever touches WOOD materials, Carving team CARVING,
// Polish team POLISH. Admin/Superadmin see everything, including
// uncategorized OTHER materials.
const GROUP_FOR_ROLE: Partial<Record<Role, 'WOOD' | 'CARVING' | 'POLISH'>> = {
  [Role.CARPENTER]: 'WOOD',
  [Role.CARVER]: 'CARVING',
  [Role.POLISHER]: 'POLISH',
};

const ROLE_LABEL_FOR_GROUP: Record<string, string> = { WOOD: 'Carpenter', CARVING: 'Carving', POLISH: 'Polish' };

// Fields a Carpenter/Carver/Polisher must never see - supplier cost,
// purchase price, bill amount, etc. They record physical stock only.
function stripFinancials<T extends { purchaseRate?: unknown; stockValue?: unknown; unitCost?: unknown }>(
  obj: T,
  viewerRole?: Role,
): T {
  if (viewerRole !== Role.CARPENTER && viewerRole !== Role.CARVER && viewerRole !== Role.POLISHER) return obj;
  const { purchaseRate, stockValue, unitCost, ...rest } = obj as any;
  return rest;
}

@Injectable()
export class RawMaterialsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private pdf: PdfService,
  ) {}

  private summarize(material: { stockMovements: { quantity: any; unitCost: any; type: string; date: Date }[] }) {
    // Board-feet quantities are routinely fractional (e.g. 116.67), and
    // summing many of them in floating point drifts to results like
    // 166.67000000000002 - round every summed figure to 2 decimals, same
    // convention as computeBalance's balanceAmount, so the UI never shows
    // raw floating-point noise.
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const byType = (t: string) => round2(sumAmounts(material.stockMovements.filter((m) => m.type === t).map((m) => ({ amount: m.quantity }))));
    const inStock = round2(sumAmounts(material.stockMovements.map((m) => ({ amount: m.quantity }))));
    // OUT movements are stored as negative quantities - Math.abs turns
    // "consumed" into a plain positive amount for display.
    const totalPurchased = byType('IN');
    const totalConsumed = Math.abs(byType('OUT'));
    const totalAdjusted = byType('ADJUSTMENT');
    const lastCostMovement = [...material.stockMovements]
      .filter((m) => m.unitCost != null)
      .sort((a, b) => b.date.getTime() - a.date.getTime())[0];
    const purchaseRate = lastCostMovement ? Number(lastCostMovement.unitCost) : 0;
    return { inStock, purchaseRate, stockValue: round2(inStock * purchaseRate), totalPurchased, totalConsumed, totalAdjusted };
  }

  // For a BOARD_FEET material, employees issuing stock shouldn't have to
  // re-type the plank size every time - it's fixed by what was actually
  // bought. Looks up the most recent Purchase that recorded a dimensioned
  // item for each material, so Issue Material can auto-fill Thickness/
  // Width/Length and only ask the employee for Pieces.
  private async lastPieceDimensionsMap(
    materialIds: string[],
  ): Promise<Map<string, { thicknessIn: number; widthIn: number; lengthFt: number }>> {
    const map = new Map<string, { thicknessIn: number; widthIn: number; lengthFt: number }>();
    if (materialIds.length === 0) return map;
    const items = await this.prisma.purchaseItem.findMany({
      where: { rawMaterialId: { in: materialIds }, thicknessIn: { not: null }, widthIn: { not: null }, lengthFt: { not: null } },
      select: { rawMaterialId: true, thicknessIn: true, widthIn: true, lengthFt: true, purchaseId: true },
    });
    if (items.length === 0) return map;
    // Not `include: { purchase: ... }` - a required-relation include throws
    // if any row's FK has gone orphaned (seen in this DB before, see the
    // "Fix orphaned rows" cleanup). Looking dates up separately degrades to
    // just skipping that row instead of 500ing the whole materials list.
    const purchases = await this.prisma.purchase.findMany({
      where: { id: { in: [...new Set(items.map((i) => i.purchaseId))] } },
      select: { id: true, purchaseDate: true },
    });
    const dateById = new Map(purchases.map((p) => [p.id, p.purchaseDate]));
    const sorted = items
      .map((i) => ({ ...i, purchaseDate: dateById.get(i.purchaseId) }))
      .filter((i): i is typeof i & { purchaseDate: Date } => i.purchaseDate != null)
      .sort((a, b) => b.purchaseDate.getTime() - a.purchaseDate.getTime());
    for (const item of sorted) {
      if (!map.has(item.rawMaterialId)) {
        map.set(item.rawMaterialId, { thicknessIn: Number(item.thicknessIn), widthIn: Number(item.widthIn), lengthFt: Number(item.lengthFt) });
      }
    }
    return map;
  }

  // Opt-in pagination, applied in JS rather than at the DB level: isLow is
  // derived from summarizing each material's stock movements, and
  // lowStockOnly filters on that derived value - paginating in SQL first
  // would silently drop matching rows that fell outside the current page
  // before the filter even ran.
  async findAll(params: { search?: string; lowStockOnly?: boolean; viewerRole?: Role; page?: number; limit?: number }) {
    const group = params.viewerRole ? GROUP_FOR_ROLE[params.viewerRole] : undefined;

    const materials = await this.prisma.rawMaterial.findMany({
      where: {
        materialGroup: group,
        OR: params.search ? [{ name: { contains: params.search } }, { type: { contains: params.search } }] : undefined,
      },
      include: {
        stockMovements: {
          select: {
            quantity: true,
            unitCost: true,
            type: true,
            date: true,
            purchase: { select: { items: { select: { rawMaterialId: true, pieces: true } } } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const dimMap = await this.lastPieceDimensionsMap(materials.filter((m) => m.measurementKind === 'BOARD_FEET').map((m) => m.id));

    const summarized = materials.map((m) => {
      const { stockMovements, ...rest } = m;
      const summary = this.summarize(m);
      const isLow = m.reorderLevel != null && summary.inStock < Number(m.reorderLevel);
      // Real sums of each movement's own recorded piece count - see the
      // identical, more detailed version of this in findOne.
      const isBoardFeet = m.measurementKind === 'BOARD_FEET';
      const piecesOf = (mv: (typeof stockMovements)[number]) => mv.purchase?.items.find((i) => i.rawMaterialId === m.id)?.pieces ?? null;
      const totalPurchasedPieces = isBoardFeet
        ? stockMovements.filter((mv) => mv.type === 'IN' && piecesOf(mv) != null).reduce((s, mv) => s + (piecesOf(mv) ?? 0), 0)
        : null;
      const totalConsumedPieces = isBoardFeet
        ? stockMovements.filter((mv) => mv.type === 'OUT' && piecesOf(mv) != null).reduce((s, mv) => s + (piecesOf(mv) ?? 0), 0)
        : null;
      const hasUntrackedAdjustment = stockMovements.some((mv) => mv.type === 'ADJUSTMENT');
      return stripFinancials(
        {
          ...rest,
          ...summary,
          isLow,
          lastPieceDimensions: dimMap.get(m.id) ?? null,
          totalPurchasedPieces,
          totalConsumedPieces,
          hasUntrackedAdjustment,
        },
        params.viewerRole,
      );
    });

    const filtered = params.lowStockOnly ? summarized.filter((m) => (m as any).isLow) : summarized;

    if (params.page == null) return filtered;
    const page = params.page;
    const limit = params.limit ?? 20;
    const { skip, take } = toSkipTake(page, limit);
    return paginate(filtered.slice(skip, skip + take), filtered.length, page, limit);
  }

  async findOne(id: string, viewerRole?: Role) {
    const material = await this.prisma.rawMaterial.findUnique({
      where: { id },
      include: {
        stockMovements: {
          orderBy: { date: 'desc' },
          include: {
            workItem: { select: { id: true, productName: true, carpenter: { select: { name: true } } } },
            purchase: {
              select: {
                id: true,
                purchaseNumber: true,
                supplier: { select: { name: true } },
                items: { select: { rawMaterialId: true, pieces: true } },
              },
            },
            createdBy: { select: { name: true } },
          },
        },
      },
    });
    if (!material) throw new NotFoundException('Raw material not found');

    const summary = this.summarize(material);
    const withPieces = material.stockMovements.map((m) => {
      const pieces = m.purchase?.items.find((i) => i.rawMaterialId === m.rawMaterialId)?.pieces ?? null;
      const purchase = m.purchase ? { id: m.purchase.id, purchaseNumber: m.purchase.purchaseNumber, supplier: m.purchase.supplier } : null;
      return { ...m, purchase, pieces };
    });
    // Real counts, not an estimate - only movements that actually carry a
    // recorded piece count (dimensioned purchases, and Issue Material once
    // Pieces is entered) contribute. A plain Stock Adjustment has no piece
    // count, so it's intentionally excluded here (see hasUntrackedAdjustment).
    // null (not 0) for a non-board-feet material, where "pieces" is
    // meaningless - the frontend falls back to the plain CFT/unit figure.
    const isBoardFeet = material.measurementKind === 'BOARD_FEET';
    const totalPurchasedPieces = isBoardFeet
      ? withPieces.filter((m) => m.type === 'IN' && m.pieces != null).reduce((s, m) => s + (m.pieces ?? 0), 0)
      : null;
    const totalConsumedPieces = isBoardFeet
      ? withPieces.filter((m) => m.type === 'OUT' && m.pieces != null).reduce((s, m) => s + (m.pieces ?? 0), 0)
      : null;
    const hasUntrackedAdjustment = withPieces.some((m) => m.type === 'ADJUSTMENT');
    const stockMovements = withPieces.map((m) => stripFinancials(m, viewerRole));
    const lastPieceDimensions =
      material.measurementKind === 'BOARD_FEET' ? (await this.lastPieceDimensionsMap([material.id])).get(material.id) ?? null : null;
    return stripFinancials(
      { ...material, stockMovements, ...summary, lastPieceDimensions, totalPurchasedPieces, totalConsumedPieces, hasUntrackedAdjustment },
      viewerRole,
    );
  }

  // Locks the unit for every measurementKind except OTHER, so a material's
  // unit and the physical quantity it's actually bought/sold in (and every
  // paired StockMovement/SupplierPurchase) can never disagree.
  private resolveUnit(measurementKind: string, requestedUnit?: string): string {
    const LOCKED: Partial<Record<string, string>> = { BOARD_FEET: 'CFT', SHEET: 'Sheet', COUNT: 'Nos' };
    if (LOCKED[measurementKind]) return LOCKED[measurementKind]!;
    if (measurementKind === 'LIQUID') {
      const LIQUID_UNITS = ['Litre', 'Kg', 'Gram'];
      if (!requestedUnit || !LIQUID_UNITS.includes(requestedUnit)) {
        throw new BadRequestException('Choose Litre, Kg or Gram for a liquid/polish material');
      }
      return requestedUnit;
    }
    if (!requestedUnit) throw new BadRequestException('Unit is required');
    return requestedUnit;
  }

  async create(dto: CreateRawMaterialDto) {
    const existing = await this.prisma.rawMaterial.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A raw material with this name already exists');
    const measurementKind = dto.measurementKind ?? 'OTHER';
    return this.prisma.rawMaterial.create({
      data: { ...dto, measurementKind, unit: this.resolveUnit(measurementKind, dto.unit) },
    });
  }

  async update(id: string, dto: UpdateRawMaterialDto) {
    const existing = await this.findOne(id);
    const measurementKind = dto.measurementKind ?? (existing.measurementKind as unknown as string);
    const unit =
      dto.measurementKind !== undefined || dto.unit !== undefined ? this.resolveUnit(measurementKind, dto.unit ?? existing.unit) : undefined;
    return this.prisma.rawMaterial.update({ where: { id }, data: { ...dto, measurementKind: measurementKind as any, unit } });
  }

  async remove(id: string) {
    await this.findOne(id);
    // Same defensive check as SuppliersService.remove() - don't rely on the
    // schema's onDelete behavior alone (MySQL FK constraints aren't
    // guaranteed to have actually been created by every `prisma db push`
    // in this project's history). Without this, deleting a material with
    // real stock/purchase history orphans those rows' rawMaterialId,
    // which then breaks any query that includes the (required) rawMaterial
    // relation on StockMovement.
    const [movementCount, purchaseItemCount, supplierPurchaseCount] = await Promise.all([
      this.prisma.stockMovement.count({ where: { rawMaterialId: id } }),
      this.prisma.purchaseItem.count({ where: { rawMaterialId: id } }),
      this.prisma.supplierPurchase.count({ where: { rawMaterialId: id } }),
    ]);
    if (movementCount > 0 || purchaseItemCount > 0 || supplierPurchaseCount > 0) {
      throw new ConflictException(
        'This material has stock movement or purchase history and cannot be deleted. Remove those entries first if you really need to delete it.',
      );
    }
    await this.prisma.rawMaterial.delete({ where: { id } });
    return { success: true };
  }

  async stockIn(dto: StockInDto, userId: string, actingRole?: Role) {
    const material = await this.prisma.rawMaterial.findUnique({ where: { id: dto.rawMaterialId } });
    if (!material) throw new NotFoundException('Raw material not found');

    const requiredGroup = actingRole ? GROUP_FOR_ROLE[actingRole] : undefined;
    if (requiredGroup && material.materialGroup !== requiredGroup) {
      throw new ForbiddenException(`${ROLE_LABEL_FOR_GROUP[requiredGroup]} team can only record stock for their own material group`);
    }

    // Carpenter/Carver/Polisher record physical quantity only - any cost they send is ignored.
    const isTeamRole = actingRole === Role.CARPENTER || actingRole === Role.CARVER || actingRole === Role.POLISHER;

    await this.prisma.stockMovement.create({
      data: {
        rawMaterialId: dto.rawMaterialId,
        type: 'IN',
        quantity: dto.quantity,
        unitCost: isTeamRole ? undefined : dto.unitCost,
        reason: dto.reason ?? 'Stock in',
        location: dto.location,
        date: new Date(dto.date),
        createdById: userId,
      },
    });
    return this.findOne(dto.rawMaterialId, actingRole);
  }

  async adjust(dto: StockAdjustmentDto, userId: string) {
    await this.findOne(dto.rawMaterialId);
    await this.prisma.stockMovement.create({
      data: {
        rawMaterialId: dto.rawMaterialId,
        type: 'ADJUSTMENT',
        quantity: dto.quantity,
        reason: dto.reason,
        date: new Date(dto.date),
        createdById: userId,
      },
    });
    return this.findOne(dto.rawMaterialId);
  }

  async issueToWorkItem(dto: IssueMaterialDto, userId: string, actingRole?: Role) {
    const workItem = await this.prisma.carpenterWorkItem.findUnique({
      where: { id: dto.workItemId },
      include: { carpenter: { select: { name: true } } },
    });
    if (!workItem) throw new NotFoundException('Work item not found');

    const materials = await Promise.all(
      dto.items.map(async (item) => {
        const material = await this.prisma.rawMaterial.findUnique({
          where: { id: item.rawMaterialId },
          include: { stockMovements: { select: { quantity: true, unitCost: true, type: true, date: true } } },
        });
        if (!material) throw new NotFoundException(`Raw material ${item.rawMaterialId} not found`);

        // For a BOARD_FEET material the actual quantity issued is server-
        // computed from the dimension fields, never trusted from the
        // client - same override pattern as Purchases' resolveItemsInput.
        const isBoardFeet = material.measurementKind === 'BOARD_FEET';
        const quantity = isBoardFeet
          ? computeBoardFeet({ thicknessIn: item.thicknessIn, widthIn: item.widthIn, lengthFt: item.lengthFt, pieces: item.pieces })
          : item.quantity;

        const { inStock, purchaseRate } = this.summarize(material);
        if (inStock < quantity) {
          throw new ConflictException(`Not enough ${material.name} in stock - available ${inStock} ${material.unit}, requested ${quantity}.`);
        }
        return { material, requested: quantity, purchaseRate };
      }),
    );

    await this.prisma.stockMovement.createMany({
      data: dto.items.map((item, idx) => ({
        rawMaterialId: item.rawMaterialId,
        type: 'OUT' as const,
        quantity: -Math.abs(materials[idx].requested),
        // Snapshot the material's purchase rate at the moment of issue, so
        // "actual material cost" per employee/day stays accurate even if
        // future purchases change the rate.
        unitCost: materials[idx].purchaseRate || undefined,
        reason: dto.reason ?? 'Issued to production',
        workItemId: dto.workItemId,
        date: new Date(dto.date),
        createdById: userId,
      })),
    });

    await this.audit.log({
      userId,
      action: 'MATERIAL_ISSUED',
      targetType: 'CarpenterWorkItem',
      targetId: dto.workItemId,
      metadata: { productName: workItem.productName, itemCount: dto.items.length },
    });

    const who = workItem.carpenter?.name ?? 'A worker';
    const when = new Date(dto.date).toLocaleString('en-IN');
    for (const { material, requested } of materials) {
      const remaining = (await this.summarizeById(material.id)) - requested;
      await this.notifications.notifyRoles([Role.SUPERADMIN, Role.ADMIN], {
        type: 'MATERIAL_USED',
        title: 'Raw material used',
        message: `${who} (${actingRole ?? workItem.stage}) used ${requested} ${material.unit} of ${material.name} for ${workItem.productName}${workItem.modelNo ? ` (${workItem.modelNo})` : ''} - ${workItem.stage} stage, ${when}.`,
        targetType: 'CarpenterWorkItem',
        targetId: dto.workItemId,
      });
      if (material.reorderLevel != null && remaining <= Number(material.reorderLevel)) {
        await this.notifications.notifyRoles([Role.SUPERADMIN, Role.ADMIN], {
          type: 'LOW_STOCK',
          title: 'Low raw material stock',
          message: `${material.name} stock is low - ${remaining} ${material.unit} remaining (reorder level ${material.reorderLevel} ${material.unit}).`,
          targetType: 'RawMaterial',
          targetId: material.id,
        });
      }
    }

    return this.prisma.stockMovement.findMany({
      where: { workItemId: dto.workItemId },
      include: { rawMaterial: true },
      orderBy: { createdAt: 'desc' },
      take: dto.items.length,
    });
  }

  private async summarizeById(rawMaterialId: string) {
    const movements = await this.prisma.stockMovement.findMany({ where: { rawMaterialId }, select: { quantity: true } });
    return sumAmounts(movements.map((m) => ({ amount: m.quantity })));
  }

  // Opt-in pagination - see the identical note on CustomerOrdersService.findAll.
  // Without `page`, keeps the previous 200-row cap so existing callers see
  // the same behavior as before.
  async findAllMovements(params: {
    rawMaterialId?: string;
    type?: string;
    workItemId?: string;
    workerType?: string;
    carpenterId?: string;
    dateFrom?: string;
    dateTo?: string;
    // A friendlier alias over `type`/the FK columns for the common ledger's
    // "Reference" filter - PURCHASE/PRODUCTION map to "this movement has
    // that FK set", ADJUSTMENT is just the existing type value. No new
    // column - purely a different way to query what's already there.
    reference?: 'PURCHASE' | 'PRODUCTION' | 'ADJUSTMENT';
    viewerRole?: Role;
    page?: number;
    limit?: number;
    // PDF export needs every matching row, not the usual 200-row safety
    // cap for an unpaginated call - a filtered report must contain exactly
    // the filtered set, per the "list PDF = filtered list" rule.
    forExport?: boolean;
  }) {
    const group = params.viewerRole ? GROUP_FOR_ROLE[params.viewerRole] : undefined;
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const referenceWhere =
      params.reference === 'PURCHASE'
        ? { purchaseId: { not: null } }
        : params.reference === 'PRODUCTION'
          ? { workItemId: { not: null } }
          : params.reference === 'ADJUSTMENT'
            ? { type: 'ADJUSTMENT' as const }
            : {};
    const where = {
      rawMaterialId: params.rawMaterialId || undefined,
      type: (params.type || undefined) as any,
      workItemId: params.workItemId || undefined,
      workItem:
        params.workerType || params.carpenterId
          ? {
              carpenterId: params.carpenterId || undefined,
              carpenter: params.workerType ? { workerType: params.workerType as any } : undefined,
            }
          : undefined,
      rawMaterial: group ? { materialGroup: group } : undefined,
      date:
        params.dateFrom || params.dateTo
          ? { gte: params.dateFrom ? new Date(params.dateFrom) : undefined, lte: params.dateTo ? new Date(params.dateTo) : undefined }
          : undefined,
      ...referenceWhere,
    };

    const [movements, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        include: {
          rawMaterial: { select: { id: true, name: true, unit: true } },
          workItem: { select: { id: true, productName: true, carpenter: { select: { name: true, workerType: true } } } },
          purchase: {
            select: {
              id: true,
              purchaseNumber: true,
              supplier: { select: { name: true } },
              // Only used to look up this movement's own line's pieces
              // count below - never returned as-is (a Purchase can have
              // other materials' items too).
              items: { select: { rawMaterialId: true, pieces: true } },
            },
          },
          createdBy: { select: { name: true } },
        },
        orderBy: { date: 'desc' },
        ...(paginated ? toSkipTake(page, limit) : { skip: 0, take: params.forExport ? 5000 : 200 }),
      }),
      paginated ? this.prisma.stockMovement.count({ where }) : Promise.resolve(0),
    ]);

    const mapped = movements.map((m) => {
      const pieces = m.purchase?.items.find((i) => i.rawMaterialId === m.rawMaterialId)?.pieces ?? null;
      const purchase = m.purchase ? { id: m.purchase.id, purchaseNumber: m.purchase.purchaseNumber, supplier: m.purchase.supplier } : null;
      return stripFinancials({ ...m, purchase, pieces }, params.viewerRole);
    });
    return paginated ? paginate(mapped, total, page, limit) : mapped;
  }

  // Builds just the summary-stats + table portion shared by both the plain
  // Movement History report and the Material detail report below - the one
  // place the row/footer HTML is written.
  private async buildMovementsSection(params: Parameters<RawMaterialsService['findAllMovements']>[0]): Promise<{ html: string; count: number }> {
    const movements = (await this.findAllMovements({ ...params, forExport: true, page: undefined, limit: undefined })) as any[];
    const rows = movements
      .map((m) => {
        const supplierOrEmployee = m.purchase?.supplier?.name ?? m.workItem?.carpenter?.name ?? '-';
        const role = m.workItem?.carpenter?.workerType ?? '-';
        const reference = m.purchase ? m.purchase.purchaseNumber : m.workItem ? `Production: ${m.workItem.productName}` : m.type === 'ADJUSTMENT' ? 'Adjustment' : '-';
        return `<tr>
          <td>${new Date(m.date).toLocaleDateString('en-IN')}</td>
          <td>${escapeHtml(m.type)}</td>
          <td style="text-align:right">${Number(m.quantity) > 0 ? '+' : ''}${Number(m.quantity)}</td>
          <td>${escapeHtml(supplierOrEmployee)}</td>
          <td>${escapeHtml(role)}</td>
          <td>${escapeHtml(reference)}</td>
          <td>${escapeHtml(m.reason ?? '-')}</td>
          <td>${escapeHtml(m.createdBy?.name ?? '-')}</td>
        </tr>`;
      })
      .join('');

    const totalIn = movements.filter((m) => m.type === 'IN').reduce((s, m) => s + Number(m.quantity), 0);
    const totalOut = movements.filter((m) => m.type === 'OUT').reduce((s, m) => s + Math.abs(Number(m.quantity)), 0);
    const totalAdjustment = movements.filter((m) => m.type === 'ADJUSTMENT').reduce((s, m) => s + Number(m.quantity), 0);
    const netMovement = totalIn - totalOut + totalAdjustment;

    const filterSummary = renderFilterSummary({
      'Date From': params.dateFrom ? new Date(params.dateFrom).toLocaleDateString('en-IN') : undefined,
      'Date To': params.dateTo ? new Date(params.dateTo).toLocaleDateString('en-IN') : undefined,
      Movement: params.type ?? undefined,
      Reference: params.reference ? REFERENCE_LABEL[params.reference] : undefined,
      Role: params.workerType ?? undefined,
    });

    const html = `
    ${filterSummary}
    <div class="summary">
      <div><div class="label">Total Stock In</div><div class="value" style="color:#15803d">+${totalIn}</div></div>
      <div><div class="label">Total Issued</div><div class="value" style="color:#b91c1c">-${totalOut}</div></div>
      <div><div class="label">Total Adjustments</div><div class="value">${totalAdjustment > 0 ? '+' : ''}${totalAdjustment}</div></div>
      <div><div class="label">Net Movement</div><div class="value">${netMovement > 0 ? '+' : ''}${netMovement}</div></div>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Type</th><th style="text-align:right">Qty</th><th>Supplier / Employee</th><th>Role</th><th>Reference</th><th>Reason</th><th>By</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:16px">No movements found</td></tr>'}</tbody>
    </table>
    ${renderGeneratedFooter(movements.length, 'movement')}`;

    return { html, count: movements.length };
  }

  // "Materials → Movement History" list PDF - whatever the user filtered
  // across every material (or one, if rawMaterialId is set in params).
  async generateMovementsPdf(params: Parameters<RawMaterialsService['findAllMovements']>[0]): Promise<Buffer> {
    const { html: sectionHtml } = await this.buildMovementsSection(params);
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${REPORT_PDF_STYLES}</style></head>
<body>
  ${renderReportHeader('Material Movement History')}
  <div class="body">${sectionHtml}</div>
</body></html>`;
    return this.pdf.renderHtmlToPdf(html);
  }

  // Material detail page PDF - this one material's summary stats plus its
  // own (optionally filtered) movement history, never any other material's
  // data.
  async generateMaterialDetailPdf(
    id: string,
    movementFilters: Omit<Parameters<RawMaterialsService['findAllMovements']>[0], 'rawMaterialId'>,
  ): Promise<Buffer> {
    const material = (await this.findOne(id)) as any;
    const { html: sectionHtml } = await this.buildMovementsSection({ ...movementFilters, rawMaterialId: id });
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${REPORT_PDF_STYLES}</style></head>
<body>
  ${renderReportHeader(material.name)}
  <div class="body">
    <p style="margin:0 0 14px;color:#6b7280;font-size:12px">${escapeHtml(material.type ?? 'Uncategorized')} &middot; Unit: ${escapeHtml(material.unit)}</p>
    <div class="summary">
      <div><div class="label">In Stock</div><div class="value">${material.inStock} ${escapeHtml(material.unit)}</div></div>
      <div><div class="label">Purchased</div><div class="value">${material.totalPurchased} ${escapeHtml(material.unit)}</div></div>
      <div><div class="label">Consumed</div><div class="value">${material.totalConsumed} ${escapeHtml(material.unit)}</div></div>
      <div><div class="label">Adjusted</div><div class="value">${material.totalAdjusted} ${escapeHtml(material.unit)}</div></div>
      ${material.purchaseRate != null ? `<div><div class="label">Purchase Rate</div><div class="value">₹${Number(material.purchaseRate).toLocaleString('en-IN')}</div></div>` : ''}
      ${material.stockValue != null ? `<div><div class="label">Stock Value</div><div class="value">₹${Number(material.stockValue).toLocaleString('en-IN')}</div></div>` : ''}
    </div>
    ${sectionHtml}
  </div>
</body></html>`;
    return this.pdf.renderHtmlToPdf(html);
  }
}
