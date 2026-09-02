import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { Role } from '../../../common/enums/role.enum';
import { sumAmounts } from '../../../common/utils/balance.util';
import { CreateRawMaterialDto } from './dto/create-raw-material.dto';
import { UpdateRawMaterialDto } from './dto/update-raw-material.dto';
import { StockInDto } from './dto/stock-in.dto';
import { StockAdjustmentDto } from './dto/stock-adjustment.dto';
import { IssueMaterialDto } from './dto/issue-material.dto';

// Carpenter team only ever touches WOOD materials, Polish team only POLISH.
// Admin/Superadmin see everything, including uncategorized OTHER materials.
const GROUP_FOR_ROLE: Partial<Record<Role, 'WOOD' | 'POLISH'>> = {
  [Role.CARPENTER]: 'WOOD',
  [Role.POLISHER]: 'POLISH',
};

// Fields a Carpenter/Polisher must never see - supplier cost, purchase
// price, bill amount, etc. They record physical stock only.
function stripFinancials<T extends { purchaseRate?: unknown; stockValue?: unknown; unitCost?: unknown }>(
  obj: T,
  viewerRole?: Role,
): T {
  if (viewerRole !== Role.CARPENTER && viewerRole !== Role.POLISHER) return obj;
  const { purchaseRate, stockValue, unitCost, ...rest } = obj as any;
  return rest;
}

@Injectable()
export class RawMaterialsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private summarize(material: { stockMovements: { quantity: any; unitCost: any; type: string; date: Date }[] }) {
    const inStock = sumAmounts(material.stockMovements.map((m) => ({ amount: m.quantity })));
    const lastCostMovement = [...material.stockMovements]
      .filter((m) => m.unitCost != null)
      .sort((a, b) => b.date.getTime() - a.date.getTime())[0];
    const purchaseRate = lastCostMovement ? Number(lastCostMovement.unitCost) : 0;
    return { inStock, purchaseRate, stockValue: inStock * purchaseRate };
  }

  async findAll(params: { search?: string; lowStockOnly?: boolean; viewerRole?: Role }) {
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
      const { inStock, purchaseRate, stockValue } = this.summarize(m);
      const isLow = m.reorderLevel != null && inStock < Number(m.reorderLevel);
      return stripFinancials({ ...rest, inStock, purchaseRate, stockValue, isLow }, params.viewerRole);
    });

    return params.lowStockOnly ? summarized.filter((m) => (m as any).isLow) : summarized;
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

    const { inStock, purchaseRate, stockValue } = this.summarize(material);
    const stockMovements = material.stockMovements.map((m) => stripFinancials(m, viewerRole));
    return stripFinancials({ ...material, stockMovements, inStock, purchaseRate, stockValue }, viewerRole);
  }

  async create(dto: CreateRawMaterialDto) {
    const existing = await this.prisma.rawMaterial.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A raw material with this name already exists');
    return this.prisma.rawMaterial.create({ data: dto });
  }

  async update(id: string, dto: UpdateRawMaterialDto) {
    await this.findOne(id);
    return this.prisma.rawMaterial.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.rawMaterial.delete({ where: { id } });
    return { success: true };
  }

  async stockIn(dto: StockInDto, userId: string, actingRole?: Role) {
    const material = await this.prisma.rawMaterial.findUnique({ where: { id: dto.rawMaterialId } });
    if (!material) throw new NotFoundException('Raw material not found');

    const requiredGroup = actingRole ? GROUP_FOR_ROLE[actingRole] : undefined;
    if (requiredGroup && material.materialGroup !== requiredGroup) {
      throw new ForbiddenException(`${actingRole === Role.CARPENTER ? 'Carpenter' : 'Polish'} team can only record stock for their own material group`);
    }

    // Carpenter/Polisher record physical quantity only - any cost they send is ignored.
    const isTeamRole = actingRole === Role.CARPENTER || actingRole === Role.POLISHER;

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

  async issueToWorkItem(dto: IssueMaterialDto, userId: string) {
    const workItem = await this.prisma.carpenterWorkItem.findUnique({ where: { id: dto.workItemId } });
    if (!workItem) throw new NotFoundException('Work item not found');

    for (const item of dto.items) {
      const material = await this.prisma.rawMaterial.findUnique({ where: { id: item.rawMaterialId } });
      if (!material) throw new NotFoundException(`Raw material ${item.rawMaterialId} not found`);
    }

    await this.prisma.stockMovement.createMany({
      data: dto.items.map((item) => ({
        rawMaterialId: item.rawMaterialId,
        type: 'OUT' as const,
        quantity: -Math.abs(item.quantity),
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

    return this.prisma.stockMovement.findMany({
      where: { workItemId: dto.workItemId },
      include: { rawMaterial: true },
      orderBy: { createdAt: 'desc' },
      take: dto.items.length,
    });
  }

  async findAllMovements(params: { rawMaterialId?: string; type?: string; workItemId?: string; workerType?: string; viewerRole?: Role }) {
    const group = params.viewerRole ? GROUP_FOR_ROLE[params.viewerRole] : undefined;

    const movements = await this.prisma.stockMovement.findMany({
      where: {
        rawMaterialId: params.rawMaterialId,
        type: params.type as any,
        workItemId: params.workItemId,
        workItem: params.workerType ? { carpenter: { workerType: params.workerType as any } } : undefined,
        rawMaterial: group ? { materialGroup: group } : undefined,
      },
      include: {
        rawMaterial: { select: { id: true, name: true, unit: true } },
        workItem: { select: { id: true, productName: true, carpenter: { select: { name: true, workerType: true } } } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { date: 'desc' },
      take: 200,
    });

    return movements.map((m) => stripFinancials(m, params.viewerRole));
  }
}
