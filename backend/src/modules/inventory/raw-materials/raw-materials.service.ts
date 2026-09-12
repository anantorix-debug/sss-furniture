import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { Role } from '../../../common/enums/role.enum';
import { sumAmounts } from '../../../common/utils/balance.util';
import { paginate, toSkipTake } from '../../../common/utils/pagination.util';
import { CreateRawMaterialDto } from './dto/create-raw-material.dto';
import { UpdateRawMaterialDto } from './dto/update-raw-material.dto';
import { StockInDto } from './dto/stock-in.dto';
import { StockAdjustmentDto } from './dto/stock-adjustment.dto';
import { IssueMaterialDto } from './dto/issue-material.dto';

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
  ) {}

  private summarize(material: { stockMovements: { quantity: any; unitCost: any; type: string; date: Date }[] }) {
    const byType = (t: string) => sumAmounts(material.stockMovements.filter((m) => m.type === t).map((m) => ({ amount: m.quantity })));
    const inStock = sumAmounts(material.stockMovements.map((m) => ({ amount: m.quantity })));
    // OUT movements are stored as negative quantities - Math.abs turns
    // "consumed" into a plain positive amount for display.
    const totalPurchased = byType('IN');
    const totalConsumed = Math.abs(byType('OUT'));
    const totalAdjusted = byType('ADJUSTMENT');
    const lastCostMovement = [...material.stockMovements]
      .filter((m) => m.unitCost != null)
      .sort((a, b) => b.date.getTime() - a.date.getTime())[0];
    const purchaseRate = lastCostMovement ? Number(lastCostMovement.unitCost) : 0;
    return { inStock, purchaseRate, stockValue: inStock * purchaseRate, totalPurchased, totalConsumed, totalAdjusted };
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
      include: { stockMovements: { select: { quantity: true, unitCost: true, type: true, date: true } } },
      orderBy: { name: 'asc' },
    });

    const summarized = materials.map((m) => {
      const { stockMovements, ...rest } = m;
      const summary = this.summarize(m);
      const isLow = m.reorderLevel != null && summary.inStock < Number(m.reorderLevel);
      return stripFinancials({ ...rest, ...summary, isLow }, params.viewerRole);
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
            purchaseOrder: { select: { id: true, poNumber: true } },
            createdBy: { select: { name: true } },
          },
        },
      },
    });
    if (!material) throw new NotFoundException('Raw material not found');

    const summary = this.summarize(material);
    const stockMovements = material.stockMovements.map((m) => stripFinancials(m, viewerRole));
    return stripFinancials({ ...material, stockMovements, ...summary }, viewerRole);
  }

  // Locks the unit for every measurementKind except OTHER, so a material's
  // unit and the physical quantity it's actually bought/sold in (and every
  // paired StockMovement/SupplierPurchase) can never disagree.
  private resolveUnit(measurementKind: string, requestedUnit?: string): string {
    const LOCKED: Partial<Record<string, string>> = { BOARD_FEET: 'Board Feet', SHEET: 'Sheet', COUNT: 'Nos' };
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
    const [movementCount, purchaseOrderItemCount, supplierPurchaseCount] = await Promise.all([
      this.prisma.stockMovement.count({ where: { rawMaterialId: id } }),
      this.prisma.purchaseOrderItem.count({ where: { rawMaterialId: id } }),
      this.prisma.supplierPurchase.count({ where: { rawMaterialId: id } }),
    ]);
    if (movementCount > 0 || purchaseOrderItemCount > 0 || supplierPurchaseCount > 0) {
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
        const { inStock, purchaseRate } = this.summarize(material);
        if (inStock < item.quantity) {
          throw new ConflictException(`Not enough ${material.name} in stock - available ${inStock} ${material.unit}, requested ${item.quantity}.`);
        }
        return { material, requested: item.quantity, purchaseRate };
      }),
    );

    await this.prisma.stockMovement.createMany({
      data: dto.items.map((item, idx) => ({
        rawMaterialId: item.rawMaterialId,
        type: 'OUT' as const,
        quantity: -Math.abs(item.quantity),
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
    viewerRole?: Role;
    page?: number;
    limit?: number;
  }) {
    const group = params.viewerRole ? GROUP_FOR_ROLE[params.viewerRole] : undefined;
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = {
      rawMaterialId: params.rawMaterialId,
      type: params.type as any,
      workItemId: params.workItemId,
      workItem:
        params.workerType || params.carpenterId
          ? {
              carpenterId: params.carpenterId,
              carpenter: params.workerType ? { workerType: params.workerType as any } : undefined,
            }
          : undefined,
      rawMaterial: group ? { materialGroup: group } : undefined,
    };

    const [movements, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        include: {
          rawMaterial: { select: { id: true, name: true, unit: true } },
          workItem: { select: { id: true, productName: true, carpenter: { select: { name: true, workerType: true } } } },
          purchaseOrder: { select: { id: true, poNumber: true } },
          createdBy: { select: { name: true } },
        },
        orderBy: { date: 'desc' },
        ...(paginated ? toSkipTake(page, limit) : { skip: 0, take: 200 }),
      }),
      paginated ? this.prisma.stockMovement.count({ where }) : Promise.resolve(0),
    ]);

    const mapped = movements.map((m) => stripFinancials(m, params.viewerRole));
    return paginated ? paginate(mapped, total, page, limit) : mapped;
  }
}
