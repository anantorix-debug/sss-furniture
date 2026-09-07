import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { WorkerType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateCarpenterDto } from './dto/create-carpenter.dto';
import { UpdateCarpenterDto } from './dto/update-carpenter.dto';
import { CreateWorkItemDto } from './dto/create-work-item.dto';
import { UpdateWorkItemDto } from './dto/update-work-item.dto';
import { CreateCarpenterPaymentDto } from './dto/create-carpenter-payment.dto';
import { Role } from '../../common/enums/role.enum';
import { paginate, toSkipTake } from '../../common/utils/pagination.util';

const HIDE_FINANCIALS_FOR: Role[] = [Role.CARPENTER, Role.CARVER, Role.POLISHER];

// Fixed sequential pipeline - every production run goes Carpenter -> Carving
// -> Polish unless Admin explicitly overrides (see updateWorkStatus's
// `skipRemainingStages`). Matches ProductionStageType's own fixed order.
const STAGE_ORDER = ['CARPENTER', 'CARVING', 'POLISH'] as const;
type Stage = (typeof STAGE_ORDER)[number];

const ROLE_FOR_STAGE: Record<Stage, Role> = {
  CARPENTER: Role.CARPENTER,
  CARVING: Role.CARVER,
  POLISH: Role.POLISHER,
};

function stripWorkItemMoney<T extends { price: any; extra: any; total: any; stockMovements?: { unitCost: any }[] }>(
  w: T,
  hide: boolean,
) {
  if (!hide) return w;
  const { price, extra, total, stockMovements, ...rest } = w as any;
  return {
    ...rest,
    stockMovements: stockMovements?.map(({ unitCost, ...m }: any) => m),
  };
}

@Injectable()
export class CarpenterService {
  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  // --- Carpenters ------------------------------------------------------

  // Opt-in pagination - see the identical note on CustomerOrdersService.findAll.
  async findAllCarpenters(params: { workerType?: string; viewerRole?: Role; page?: number; limit?: number } = {}) {
    const hide = params.viewerRole ? HIDE_FINANCIALS_FOR.includes(params.viewerRole) : false;
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = { workerType: params.workerType as any };
    const [carpenters, total] = await Promise.all([
      this.prisma.carpenter.findMany({
        where,
        include: { workItems: true, payments: true, user: { select: { id: true, name: true, role: true } } },
        orderBy: { name: 'asc' },
        ...(paginated ? toSkipTake(page, limit) : {}),
      }),
      paginated ? this.prisma.carpenter.count({ where }) : Promise.resolve(0),
    ]);
    const mapped = carpenters.map((c) => {
      const totalWorkValue = c.workItems.reduce((sum, w) => sum + Number(w.total), 0);
      const totalPaid = c.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        workerType: c.workerType,
        workItemCount: c.workItems.length,
        user: c.user,
        ...(hide ? {} : { totalWorkValue, totalPaid, balance: totalWorkValue - totalPaid }),
      };
    });
    return paginated ? paginate(mapped, total, page, limit) : mapped;
  }

  async findOneCarpenter(id: string, viewerRole?: Role) {
    const hide = viewerRole ? HIDE_FINANCIALS_FOR.includes(viewerRole) : false;
    const carpenter = await this.prisma.carpenter.findUnique({
      where: { id },
      include: {
        workItems: { orderBy: { workDate: 'desc' } },
        payments: { orderBy: { date: 'desc' } },
      },
    });
    if (!carpenter) throw new NotFoundException('Carpenter not found');

    const totalWorkValue = carpenter.workItems.reduce((sum, w) => sum + Number(w.total), 0);
    const totalPaid = carpenter.payments.reduce((sum, p) => sum + Number(p.amount), 0);

    if (hide) {
      const { payments, workItems, ...rest } = carpenter;
      return { ...rest, workItems: workItems.map((w) => stripWorkItemMoney(w, true)) };
    }
    return { ...carpenter, totalWorkValue, totalPaid, balance: totalWorkValue - totalPaid };
  }

  async createCarpenter(dto: CreateCarpenterDto) {
    const existing = await this.prisma.carpenter.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A carpenter with this name already exists');
    if (dto.userId) await this.assertLoginNotLinked(dto.userId);
    return this.prisma.carpenter.create({ data: dto });
  }

  async updateCarpenter(id: string, dto: UpdateCarpenterDto) {
    await this.findOneCarpenter(id);
    if (dto.userId) await this.assertLoginNotLinked(dto.userId, id);
    return this.prisma.carpenter.update({ where: { id }, data: dto });
  }

  private async assertLoginNotLinked(userId: string, excludeCarpenterId?: string) {
    const existing = await this.prisma.carpenter.findUnique({ where: { userId } });
    if (existing && existing.id !== excludeCarpenterId) {
      throw new ConflictException(`This login is already linked to worker "${existing.name}"`);
    }
  }

  // Resolves the current login to their own payee record, if linked - "My
  // Work" uses this to find which CarpenterWorkItem rows are theirs.
  async findMyCarpenter(userId: string) {
    return this.prisma.carpenter.findUnique({ where: { userId } });
  }

  async removeCarpenter(id: string) {
    await this.findOneCarpenter(id);
    // Same defensive check as SuppliersService.remove: don't rely on the
    // schema's onDelete behavior alone (MySQL FK constraints aren't
    // guaranteed to have actually been created by every `prisma db push`
    // in this project's history) - block deletion when there's real
    // history instead of risking an orphaned or unexpectedly-cascaded row.
    const [workItemCount, paymentCount] = await Promise.all([
      this.prisma.carpenterWorkItem.count({ where: { carpenterId: id } }),
      this.prisma.carpenterPayment.count({ where: { carpenterId: id } }),
    ]);
    if (workItemCount > 0 || paymentCount > 0) {
      throw new ConflictException(
        'This worker has work items or payment history and cannot be deleted. Remove those first if you really need to delete the worker.',
      );
    }
    await this.prisma.carpenter.delete({ where: { id } });
    return { success: true };
  }

  // --- Work items --------------------------------------------------------

  // Opt-in pagination - see the identical note on CustomerOrdersService.findAll.
  // `status` was previously accepted by no one - the frontend Production
  // page was already filtering by it in the query string with no effect
  // server-side, silently returning every status. Fixed here.
  async findAllWorkItems(params: {
    carpenterId?: string;
    workerType?: string;
    status?: string;
    stage?: string;
    source?: string;
    batchId?: string;
    sourceCustomerOrderId?: string;
    sourcePartyOrderItemId?: string;
    viewerRole?: Role;
    page?: number;
    limit?: number;
  }) {
    const hide = params.viewerRole ? HIDE_FINANCIALS_FOR.includes(params.viewerRole) : false;
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = {
      carpenterId: params.carpenterId,
      status: params.status as any,
      stage: params.stage as any,
      source: params.source as any,
      batchId: params.batchId,
      sourceCustomerOrderId: params.sourceCustomerOrderId,
      sourcePartyOrderItemId: params.sourcePartyOrderItemId,
      carpenter: params.workerType ? { workerType: params.workerType as any } : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.carpenterWorkItem.findMany({
        where,
        include: {
          carpenter: { select: { id: true, name: true, phone: true, workerType: true } },
          createdBy: { select: { name: true } },
          stockMovements: { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } },
        },
        orderBy: { workDate: 'desc' },
        ...(paginated ? toSkipTake(page, limit) : {}),
      }),
      paginated ? this.prisma.carpenterWorkItem.count({ where }) : Promise.resolve(0),
    ]);
    const mapped = items.map((w) => stripWorkItemMoney(w, hide));
    return paginated ? paginate(mapped, total, page, limit) : mapped;
  }

  async createWorkItem(
    dto: CreateWorkItemDto,
    userId: string,
    viewerRole?: Role,
    sourceInfo?: {
      source?: 'CUSTOMER_ORDER' | 'PARTY_ORDER';
      sourceCustomerOrderId?: string;
      sourcePartyOrderItemId?: string;
      assignedById?: string;
    },
  ) {
    // Matches the reference workflow: "Carpenter Can Add & Update Own Cot
    // Work" but "Carpenter Cannot Edit Labour Price - Co-Admin Enters
    // Labour Price at Week End". A Carpenter/Polisher creating their own
    // entry gets price/total forced to 0 no matter what they send; only
    // Admin (or above) may set a price directly at creation time.
    const isWorkerSelfEntry = viewerRole === Role.CARPENTER || viewerRole === Role.CARVER || viewerRole === Role.POLISHER;
    const price = isWorkerSelfEntry ? 0 : (dto.price ?? 0);
    const extra = isWorkerSelfEntry ? 0 : (dto.extra ?? 0);
    const quantity = dto.quantity ?? 1;
    // total is never taken from the client - always (price + extra) *
    // quantity, matching the reference sheet's PRICE / EXTRA+ / NO / TOTAL
    // columns, so it can never be typed wrong or left inconsistent.
    const total = (price + extra) * quantity;

    // Stage-skip guard (spec: "do not allow stages to be incorrectly
    // skipped unless Super Admin/Admin has permission to override"). A
    // fresh manual entry may only start at CARPENTER unless the caller is
    // Admin+ - the normal CARVING/POLISH rows are created by the automatic
    // handoff in updateWorkStatus, never typed in directly by a worker.
    const stage = (dto.stage as unknown as Stage) ?? 'CARPENTER';
    if (stage !== 'CARPENTER' && viewerRole !== Role.SUPERADMIN && viewerRole !== Role.ADMIN) {
      throw new ForbiddenException('Only Super Admin/Admin can start a production run directly at Carving or Polish.');
    }

    const workItem = await this.prisma.carpenterWorkItem.create({
      data: {
        carpenterId: dto.carpenterId,
        stage: dto.stage,
        workDate: new Date(dto.workDate),
        modelNo: dto.modelNo,
        productName: dto.productName,
        category: dto.category,
        size: dto.size,
        price,
        extra,
        quantity,
        total,
        productId: dto.productId,
        notes: dto.notes,
        batchId: randomUUID(),
        assignedById: sourceInfo?.assignedById ?? (isWorkerSelfEntry ? undefined : userId),
        source: sourceInfo?.source,
        sourceCustomerOrderId: sourceInfo?.sourceCustomerOrderId,
        sourcePartyOrderItemId: sourceInfo?.sourcePartyOrderItemId,
        createdById: userId,
      },
      include: { carpenter: true },
    });

    await this.audit.log({
      userId,
      action: 'WORK_ITEM_CREATED',
      targetType: 'CarpenterWorkItem',
      targetId: workItem.id,
      metadata: { productName: workItem.productName, carpenterName: workItem.carpenter?.name },
    });

    const whatsapp = await this.finalizeAssignment(workItem, dto.notifyWhatsapp);
    return { ...workItem, whatsapp };
  }

  // Customer/Party Order production already gets an unassigned placeholder
  // CarpenterWorkItem the moment the order is created (see
  // StockAllocationService.allocate - it creates one whenever a line's
  // productionQty > 0, so it shows up as "Waiting" immediately, before any
  // employee is picked). The unified "Assign to Production" flow must claim
  // that same row instead of creating a second one - otherwise the order's
  // production quantity is silently double-counted the moment this is
  // called. Falls back to a fresh createWorkItem only if no such
  // placeholder exists (e.g. it was already claimed/completed before, and
  // this is a genuinely new stage/run).
  async assignSourceProduction(
    sourceInfo: { source: 'CUSTOMER_ORDER' | 'PARTY_ORDER'; sourceCustomerOrderId?: string; sourcePartyOrderItemId?: string; assignedById: string },
    dto: CreateWorkItemDto,
    userId: string,
    viewerRole?: Role,
  ) {
    const placeholder = await this.prisma.carpenterWorkItem.findFirst({
      where: {
        sourceCustomerOrderId: sourceInfo.sourceCustomerOrderId,
        sourcePartyOrderItemId: sourceInfo.sourcePartyOrderItemId,
        carpenterId: null,
        status: 'ASSIGNED',
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!placeholder) {
      // No unclaimed placeholder left - either this line never had one (no
      // productionQty at order time) or it was already claimed by an
      // earlier "Assign to Production" call. Guard against the second
      // case explicitly: silently creating a second work item here would
      // double the batch (two Carpenter jobs, eventually two
      // FinishedStockItems, for units the order only needs once).
      const alreadyAssigned = await this.prisma.carpenterWorkItem.findFirst({
        where: {
          sourceCustomerOrderId: sourceInfo.sourceCustomerOrderId,
          sourcePartyOrderItemId: sourceInfo.sourcePartyOrderItemId,
        },
      });
      if (alreadyAssigned) {
        throw new ConflictException(
          'Production has already been assigned for this line. Manage or reassign the existing job from Production / My Work instead of assigning it again.',
        );
      }
      return this.createWorkItem(dto, userId, viewerRole, sourceInfo);
    }

    const isWorkerSelfEntry = viewerRole === Role.CARPENTER || viewerRole === Role.CARVER || viewerRole === Role.POLISHER;
    const price = isWorkerSelfEntry ? 0 : (dto.price ?? 0);
    const extra = isWorkerSelfEntry ? 0 : (dto.extra ?? 0);
    const quantity = dto.quantity ?? placeholder.quantity;
    const total = (price + extra) * quantity;

    const workItem = await this.prisma.carpenterWorkItem.update({
      where: { id: placeholder.id },
      data: {
        carpenterId: dto.carpenterId,
        stage: dto.stage ?? placeholder.stage,
        workDate: new Date(dto.workDate),
        modelNo: dto.modelNo ?? placeholder.modelNo,
        category: dto.category,
        size: dto.size ?? placeholder.size,
        price,
        extra,
        quantity,
        total,
        notes: dto.notes,
        batchId: placeholder.batchId ?? randomUUID(),
        assignedById: sourceInfo.assignedById,
      },
      include: { carpenter: true },
    });

    await this.audit.log({
      userId,
      action: 'WORK_ITEM_CREATED',
      targetType: 'CarpenterWorkItem',
      targetId: workItem.id,
      metadata: { productName: workItem.productName, carpenterName: workItem.carpenter?.name },
    });

    const whatsapp = await this.finalizeAssignment(workItem, dto.notifyWhatsapp);
    return { ...workItem, whatsapp };
  }

  private async finalizeAssignment(
    workItem: {
      id: string;
      stage: string;
      productName: string;
      modelNo: string | null;
      quantity: number;
      category: string | null;
      size: string | null;
      price: any;
      extra: any;
      total: any;
      workDate: Date;
      carpenter: { name: string; phone: string | null; workerType: WorkerType } | null;
    },
    notifyWhatsapp: boolean | undefined,
  ) {
    if (workItem.carpenter) {
      await this.notifyStageEvent(workItem, 'ASSIGNED', `${this.stageLabel(workItem.stage)} work assigned - ${workItem.productName}${workItem.modelNo ? ` (${workItem.modelNo})` : ''}, Qty ${workItem.quantity}, to ${workItem.carpenter.name}.`);
    }

    let whatsapp: { sent: boolean; reason?: string } | undefined;
    if (notifyWhatsapp !== false && workItem.carpenter) {
      const groupId = await this.whatsapp.getGroupIdForWorkerType(workItem.carpenter.workerType);
      if (workItem.carpenter.phone || groupId) {
        whatsapp = await this.whatsapp.sendWorkAssignment({
          carpenterName: workItem.carpenter.name,
          phone: workItem.carpenter.phone,
          groupId,
          productName: workItem.productName,
          modelNo: workItem.modelNo,
          category: workItem.category,
          size: workItem.size,
          quantity: workItem.quantity,
          price: Number(workItem.price),
          extra: Number(workItem.extra),
          total: Number(workItem.total),
          workDate: workItem.workDate,
        });
      }
    }
    return whatsapp;
  }

  private stageLabel(stage: string) {
    return stage === 'CARPENTER' ? 'Carpenter' : stage === 'CARVING' ? 'Carving' : 'Polishing';
  }

  private async notifyStageEvent(workItem: { id: string }, type: string, message: string) {
    await this.notifications.notifyRoles([Role.SUPERADMIN, Role.ADMIN], {
      type,
      title: 'Production update',
      message,
      targetType: 'CarpenterWorkItem',
      targetId: workItem.id,
    });
  }

  // Auto-assign policy for stage handoff: whichever active worker of this
  // type currently has the fewest jobs still in flight (ASSIGNED/
  // IN_PROGRESS) picks up the new one - simple load balancing, not a
  // round-robin queue. Returns null (leave unassigned, manual "Assign" on
  // Production Control still works) when no worker of that type exists.
  private async pickLeastBusyWorker(workerType: WorkerType) {
    const candidates = await this.prisma.carpenter.findMany({
      where: { workerType },
      include: { workItems: { where: { status: { in: ['ASSIGNED', 'IN_PROGRESS'] } }, select: { id: true } } },
    });
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => a.workItems.length - b.workItems.length || a.name.localeCompare(b.name))[0];
  }

  async updateWorkItem(id: string, dto: UpdateWorkItemDto) {
    const existing = await this.prisma.carpenterWorkItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Work item not found');

    const previousCarpenterId = existing.carpenterId;

    // Recompute total from whichever of price/extra/quantity changed,
    // merged with the existing values - same rule as createWorkItem.
    const priceChanged = dto.price !== undefined || dto.extra !== undefined || dto.quantity !== undefined;
    const price = dto.price ?? Number(existing.price);
    const extra = dto.extra ?? Number(existing.extra);
    const quantity = dto.quantity ?? existing.quantity;

    const workItem = await this.prisma.carpenterWorkItem.update({
      where: { id },
      data: {
        carpenterId: dto.carpenterId,
        stage: dto.stage,
        workDate: dto.workDate ? new Date(dto.workDate) : undefined,
        modelNo: dto.modelNo,
        productName: dto.productName,
        category: dto.category,
        size: dto.size,
        price: dto.price,
        extra: dto.extra,
        quantity: dto.quantity,
        total: priceChanged ? (price + extra) * quantity : undefined,
      },
      include: { carpenter: true },
    });

    let whatsapp: { sent: boolean; reason?: string } | undefined;
    const carpenterChanged = dto.carpenterId && dto.carpenterId !== previousCarpenterId;
    if (dto.notifyWhatsapp && carpenterChanged && workItem.carpenter) {
      const groupId = await this.whatsapp.getGroupIdForWorkerType(workItem.carpenter.workerType);
      if (workItem.carpenter.phone || groupId) {
        whatsapp = await this.whatsapp.sendWorkAssignment({
          carpenterName: workItem.carpenter.name,
          phone: workItem.carpenter.phone,
          groupId,
          productName: workItem.productName,
          modelNo: workItem.modelNo,
          category: workItem.category,
          size: workItem.size,
          quantity: workItem.quantity,
          price: Number(workItem.price),
          extra: Number(workItem.extra),
          total: Number(workItem.total),
          workDate: workItem.workDate,
        });
      }
    }

    return { ...workItem, whatsapp };
  }

  async removeWorkItem(id: string) {
    const existing = await this.prisma.carpenterWorkItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Work item not found');
    await this.prisma.carpenterWorkItem.delete({ where: { id } });
    return { success: true };
  }

  async notifyWorkItem(id: string) {
    const workItem = await this.prisma.carpenterWorkItem.findUnique({ where: { id }, include: { carpenter: true } });
    if (!workItem) throw new NotFoundException('Work item not found');
    if (!workItem.carpenter) throw new ConflictException('This work item has no carpenter assigned');

    const groupId = await this.whatsapp.getGroupIdForWorkerType(workItem.carpenter.workerType);
    if (!workItem.carpenter.phone && !groupId) {
      throw new ConflictException('Carpenter has no phone number on file and no team group is configured');
    }

    return this.whatsapp.sendWorkAssignment({
      carpenterName: workItem.carpenter.name,
      phone: workItem.carpenter.phone,
      groupId,
      productName: workItem.productName,
      modelNo: workItem.modelNo,
      category: workItem.category,
      size: workItem.size,
      quantity: workItem.quantity,
      price: Number(workItem.price),
      extra: Number(workItem.extra),
      total: Number(workItem.total),
      workDate: workItem.workDate,
    });
  }

  async findOneWorkItem(id: string, viewerRole?: Role) {
    const hide = viewerRole ? HIDE_FINANCIALS_FOR.includes(viewerRole) : false;
    const workItem = await this.prisma.carpenterWorkItem.findUnique({
      where: { id },
      include: {
        carpenter: { select: { id: true, name: true, phone: true, workerType: true } },
        createdBy: { select: { name: true } },
        stockMovements: { include: { rawMaterial: { select: { id: true, name: true, unit: true } } }, orderBy: { date: 'desc' } },
      },
    });
    if (!workItem) throw new NotFoundException('Work item not found');
    return stripWorkItemMoney(workItem, hide);
  }

  async updateWorkStatus(id: string, dto: { status: string; qcNote?: string; force?: boolean }, viewerRole?: Role, userId?: string) {
    const existing = await this.prisma.carpenterWorkItem.findUnique({
      where: { id },
      include: { carpenter: { select: { name: true } } },
    });
    if (!existing) throw new NotFoundException('Work item not found');

    // A production employee (not Admin+) may only progress their own
    // assigned work, resolved via their linked Carpenter profile - never
    // someone else's item, even if they know its id.
    const isWorkerRole = viewerRole === Role.CARPENTER || viewerRole === Role.CARVER || viewerRole === Role.POLISHER;
    if (isWorkerRole) {
      const own = userId ? await this.prisma.carpenter.findUnique({ where: { userId } }) : null;
      if (!own || existing.carpenterId !== own.id) {
        throw new ForbiddenException('This work item is not assigned to you');
      }
    }

    // Stage-skip guard: a stage can only be marked COMPLETED/QUALITY_CHECK
    // if it's genuinely finished - the *pipeline itself* never lets a
    // request "complete" straight past Carving/Polish (those rows don't
    // exist yet until the previous stage hands off), so the only real skip
    // risk is an Admin manually completing an earlier stage while a later
    // one already has work logged against it out of order. Guard that.
    const wantsComplete = (dto.status === 'COMPLETED' || dto.status === 'QUALITY_CHECK') && existing.status !== dto.status;
    if (wantsComplete && existing.batchId) {
      const laterStages = STAGE_ORDER.slice(STAGE_ORDER.indexOf(existing.stage as Stage) + 1);
      if (laterStages.length) {
        const alreadyStarted = await this.prisma.carpenterWorkItem.findFirst({
          where: { batchId: existing.batchId, stage: { in: laterStages as any } },
        });
        if (alreadyStarted && viewerRole !== Role.SUPERADMIN && viewerRole !== Role.ADMIN) {
          throw new ConflictException('A later stage of this production run already exists - stages cannot be completed out of order.');
        }
      }
    }

    // Final-stage completion (POLISH, or any stage under Admin override)
    // does NOT jump straight to COMPLETED - it lands on QUALITY_CHECK
    // ("ready for verification"), and nothing is added to stock until
    // Admin explicitly calls verify(). A non-final stage instead hands off
    // to the next stage automatically.
    const isAdmin = viewerRole === Role.SUPERADMIN || viewerRole === Role.ADMIN;
    const isFinalStage = existing.stage === 'POLISH' || (dto.force && isAdmin);
    const clientWantsFinish = dto.status === 'COMPLETED';
    const effectiveStatus = clientWantsFinish ? (isFinalStage ? 'QUALITY_CHECK' : 'COMPLETED') : dto.status;

    const now = new Date();
    const updated = await this.prisma.carpenterWorkItem.update({
      where: { id },
      data: {
        status: effectiveStatus as any,
        qcNote: dto.qcNote,
        startedAt: dto.status === 'IN_PROGRESS' && !existing.startedAt ? now : undefined,
        finishedAt: (effectiveStatus === 'COMPLETED' || effectiveStatus === 'QUALITY_CHECK') && !existing.finishedAt ? now : undefined,
      },
    });

    const justFinishedStage = clientWantsFinish && existing.status !== 'COMPLETED' && existing.status !== ('QUALITY_CHECK' as any);
    if (justFinishedStage) {
      if (!isFinalStage) {
        // Hand off to the next stage automatically - same batch, qty,
        // source and links. Auto-assigns to whichever active worker of the
        // next stage's type currently has the fewest active jobs (load
        // balancing); if no such worker exists yet, it's created unassigned
        // and stays available for the manual "Assign" action on Production
        // Control - auto and manual assignment are both always available,
        // auto is just the first attempt.
        const nextStage = STAGE_ORDER[STAGE_ORDER.indexOf(existing.stage as Stage) + 1];
        const autoWorker = await this.pickLeastBusyWorker(ROLE_FOR_STAGE[nextStage] as unknown as WorkerType);
        const created = await this.prisma.carpenterWorkItem.create({
          data: {
            stage: nextStage as any,
            workDate: now,
            modelNo: existing.modelNo,
            productName: existing.productName,
            category: existing.category,
            size: existing.size,
            price: 0,
            extra: 0,
            quantity: existing.quantity,
            total: 0,
            status: 'ASSIGNED',
            productId: existing.productId,
            batchId: existing.batchId,
            notes: existing.notes,
            carpenterId: autoWorker?.id,
            assignedById: autoWorker ? userId : undefined,
            source: existing.source,
            sourceCustomerOrderId: existing.sourceCustomerOrderId,
            sourcePartyOrderItemId: existing.sourcePartyOrderItemId,
            createdById: userId!,
          },
          include: { carpenter: true },
        });
        await this.notifyStageEvent(
          updated,
          'STAGE_HANDOFF',
          `${this.stageLabel(existing.stage)} completed ${existing.productName}${existing.modelNo ? ` (${existing.modelNo})` : ''} - Qty ${existing.quantity}. Sent to ${this.stageLabel(nextStage)}${
            autoWorker ? ` - auto-assigned to ${autoWorker.name}.` : ' - no available worker, please assign manually.'
          }`,
        );
        if (autoWorker) {
          await this.finalizeAssignment(created, true);
        }
      } else {
        await this.notifyStageEvent(
          updated,
          'READY_FOR_VERIFICATION',
          `${existing.productName}${existing.modelNo ? ` (${existing.modelNo})` : ''} - Qty ${existing.quantity} finished ${this.stageLabel(existing.stage)} and is ready for verification.`,
        );
      }
    }

    // Notify Super Admin/Admin of every genuine status transition (not a
    // re-save while already at that status) - same event for every worker
    // type (Carpenter/Polisher/Carver), since they all share this one
    // work-item status flow. The stage-finish transitions above already
    // send their own richer message; this generic one covers everything
    // else (ASSIGNED -> IN_PROGRESS, -> REWORK, ...) so nothing goes
    // unnoticed.
    if (dto.status !== existing.status) {
      await this.audit.log({
        userId,
        action: effectiveStatus === 'COMPLETED' ? 'WORK_ITEM_COMPLETED' : 'WORK_ITEM_STATUS_CHANGED',
        targetType: 'CarpenterWorkItem',
        targetId: id,
        metadata: {
          stage: existing.stage,
          modelNo: existing.modelNo,
          productName: existing.productName,
          carpenterName: existing.carpenter?.name,
          fromStatus: existing.status,
          toStatus: effectiveStatus,
        },
      });
    }

    return this.findOneWorkItem(id, viewerRole);
  }

  // Admin-only, explicit "Verify & Add to Stock" action - the only path
  // that actually creates real Product/FinishedStockItem rows. Replaces
  // the old behavior of doing this automatically the moment any stage hit
  // COMPLETED; now nothing reaches stock until an Admin has looked at it.
  async verifyAndAddToStock(id: string, userId: string) {
    const workItem = await this.prisma.carpenterWorkItem.findUnique({ where: { id } });
    if (!workItem) throw new NotFoundException('Work item not found');
    if (workItem.status !== 'QUALITY_CHECK') {
      // Idempotency guard - covers both "not ready yet" and "already
      // verified" (a verified item moves on to COMPLETED below), so a
      // duplicate click can never add the same units to stock twice.
      throw new ConflictException(
        workItem.status === 'COMPLETED'
          ? 'This production item has already been added to stock.'
          : 'This production item is not ready for verification yet.',
      );
    }

    await this.applyCompletionToStock(workItem, userId);

    const updated = await this.prisma.carpenterWorkItem.update({
      where: { id },
      data: { status: 'COMPLETED' },
    });

    await this.audit.log({
      userId,
      action: 'WORK_ITEM_VERIFIED',
      targetType: 'CarpenterWorkItem',
      targetId: id,
      metadata: { stage: workItem.stage, modelNo: workItem.modelNo, productName: workItem.productName, source: workItem.source },
    });

    await this.notifyStageEvent(
      updated,
      'ADDED_TO_STOCK',
      workItem.source === 'STOCK'
        ? `${workItem.productName}${workItem.modelNo ? ` (${workItem.modelNo})` : ''} - Qty ${workItem.quantity} verified and added to Godown Stock.`
        : `${workItem.productName}${workItem.modelNo ? ` (${workItem.modelNo})` : ''} - Qty ${workItem.quantity} verified and is ready for dispatch.`,
    );

    return this.findOneWorkItem(id);
  }

  // STOCK source -> creates one new Godown Stock row per completed unit
  // (manufacture with no order, spec section 7/A). Every Model No is
  // exactly one physical piece, never a quantity - a work item completing
  // 10 units creates 10 separate rows, each independently trackable/
  // sellable, all "Not Updated" until assigned a Model No individually
  // (except when the whole item is exactly 1 unit, in which case the
  // work item's own modelNo, if already typed, applies directly).
  // CUSTOMER_ORDER/PARTY_ORDER source -> creates a FinishedStockItem for
  // that job instead, ready for the existing Dispatch Pipeline, and never
  // touches Product/Godown Stock - this is what keeps order-bound
  // production from being double-counted as free stock.
  private async applyCompletionToStock(
    workItem: {
      id: string;
      source: string;
      productId: string | null;
      modelNo: string | null;
      productName: string;
      size: string | null;
      quantity: number;
      sourceCustomerOrderId: string | null;
      sourcePartyOrderItemId: string | null;
      batchId: string | null;
    },
    userId: string,
  ) {
    if (workItem.source === 'STOCK') {
      // productId, if set, is a reference design to copy descriptive
      // fields from (Finish/Size/Pattern/Price) - never a row to
      // increment, since a design and a physical unit aren't the same
      // thing under the one-piece-per-Model-No rule.
      const template = workItem.productId ? await this.prisma.product.findUnique({ where: { id: workItem.productId } }) : null;
      const singleModelNo = workItem.quantity === 1 ? workItem.modelNo : null;

      await this.prisma.$transaction(async (tx) => {
        let firstCreatedId: string | null = null;
        for (let i = 0; i < workItem.quantity; i++) {
          const created = await tx.product.create({
            data: {
              modelNo: i === 0 && singleModelNo ? singleModelNo : undefined,
              name: template?.name ?? workItem.productName,
              category: template?.category ?? undefined,
              modelSize: template?.modelSize ?? workItem.size ?? undefined,
              materialFinish: template?.materialFinish ?? undefined,
              sizeUnit: template?.sizeUnit ?? undefined,
              pattern: template?.pattern ?? undefined,
              details: template?.details ?? undefined,
              unit: template?.unit ?? undefined,
              retailPrice: template?.retailPrice ?? 0,
              wholesalePrice: template?.wholesalePrice ?? undefined,
              costPrice: template?.costPrice ?? undefined,
              quantity: 1,
              availableQuantity: 1,
              sourceBatchId: workItem.batchId,
            },
          });
          if (i === 0) firstCreatedId = created.id;
          await tx.productStockMovement.create({
            data: {
              productId: created.id,
              type: 'IN',
              quantity: 1,
              previousAvailable: 0,
              newAvailable: 1,
              reason: `Production → Stock (work item ${workItem.id})`,
              createdById: userId,
            },
          });
        }
        // Only when the work item is exactly one unit does "the product
        // this work item produced" resolve to a single row - link it so a
        // later Model No edit on the work item can still find it.
        if (workItem.quantity === 1 && firstCreatedId) {
          await tx.carpenterWorkItem.update({ where: { id: workItem.id }, data: { productId: firstCreatedId } });
        }
      });
      return;
    }

    // CUSTOMER_ORDER / PARTY_ORDER: file into FinishedStockItem, not stock.
    const jobNumber =
      (workItem.sourceCustomerOrderId
        ? (await this.prisma.customerOrder.findUnique({ where: { id: workItem.sourceCustomerOrderId } }))?.jobNumber
        : (await this.prisma.partyOrderItem.findUnique({ where: { id: workItem.sourcePartyOrderItemId! }, include: { order: true } }))?.order.jobNumber) ??
      workItem.modelNo ??
      workItem.id;

    await this.prisma.finishedStockItem.create({
      data: {
        jobNumber,
        productName: workItem.productName,
        quantity: workItem.quantity,
        completionDate: new Date(),
        status: 'AVAILABLE',
        productId: workItem.productId,
        sourceCustomerOrderId: workItem.sourceCustomerOrderId,
        sourcePartyOrderItemId: workItem.sourcePartyOrderItemId,
      },
    });
  }

  // Narrow, non-Admin-gated Model No entry for the employee who actually
  // did the work (spec: "Production Employee can update the Model No after
  // manufacturing"). Propagates to the linked order/stock record so it's
  // never just sitting on the work item disconnected from what it's for.
  async updateWorkItemModelNo(id: string, modelNo: string, userId: string) {
    const trimmed = modelNo.trim();
    if (!trimmed) throw new BadRequestException('Model No cannot be empty');

    const workItem = await this.prisma.carpenterWorkItem.findUnique({ where: { id } });
    if (!workItem) throw new NotFoundException('Work item not found');

    // Only the Carpenter/Carving stages ever know the Model No - it's
    // decided/carved into the piece while it's being made, not afterward
    // during Polish. Blocked regardless of who's asking (Admin included)
    // once the batch has moved past Carving.
    if (workItem.stage === 'POLISH') {
      throw new BadRequestException('Model No can only be entered during the Carpenter or Carving stage, not Polish.');
    }

    // A Model No is one physical piece - a work item covering more than
    // one unit can't pre-assign a single Model No to all of them. Once
    // production completes, each of the individually-created Godown Stock
    // rows gets its own Model No from Stock Management directly.
    if (workItem.source === 'STOCK' && workItem.quantity !== 1) {
      throw new BadRequestException(
        'This work item covers multiple units - assign a Model No to each piece individually in Stock Management after production completes.',
      );
    }

    await this.prisma.carpenterWorkItem.update({ where: { id }, data: { modelNo: trimmed } });

    if (workItem.source === 'STOCK') {
      // Already completed (a single row exists) - keep it in sync. Not yet
      // completed - nothing to sync yet; applyCompletionToStock applies
      // this modelNo to the one row it creates.
      if (workItem.productId) {
        await this.prisma.product.update({ where: { id: workItem.productId }, data: { modelNo: trimmed } });
      }
    } else if (workItem.source === 'CUSTOMER_ORDER' && workItem.sourceCustomerOrderId) {
      await this.prisma.customerOrder.update({
        where: { id: workItem.sourceCustomerOrderId },
        data: { cotTrack: trimmed, modelNoUpdatedById: userId, modelNoUpdatedAt: new Date() },
      });
    } else if (workItem.source === 'PARTY_ORDER' && workItem.sourcePartyOrderItemId) {
      await this.prisma.partyOrderItem.update({
        where: { id: workItem.sourcePartyOrderItemId },
        data: { modelNo: trimmed, modelNoUpdatedById: userId, modelNoUpdatedAt: new Date() },
      });
    }

    await this.audit.log({
      userId,
      action: 'MODEL_NO_UPDATED',
      targetType: 'CarpenterWorkItem',
      targetId: id,
      metadata: { modelNo: trimmed, source: workItem.source },
    });

    return this.findOneWorkItem(id);
  }

  // Powers the Production Control Center: KPI counts plus the five
  // groupings (Today's Work / Waiting / Stock Production / Order
  // Production / Completed Today) in one query instead of the client
  // stitching several list calls together.
  async getDashboard() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const items = await this.prisma.carpenterWorkItem.findMany({
      include: {
        carpenter: { select: { id: true, name: true, workerType: true } },
        stockMovements: { select: { id: true, unitCost: true } },
      },
      orderBy: { workDate: 'desc' },
    });

    const active = items.filter((w) => w.status === 'ASSIGNED' || w.status === 'IN_PROGRESS');
    const waiting = items.filter((w) => w.status === 'ASSIGNED' && !w.carpenterId);
    const readyForVerification = items.filter((w) => w.status === 'QUALITY_CHECK');
    const completedToday = items.filter((w) => w.finishedAt && new Date(w.finishedAt) >= startOfToday && w.status === 'COMPLETED');
    const todaysWork = items.filter((w) => new Date(w.workDate) >= startOfToday && (w.status === 'ASSIGNED' || w.status === 'IN_PROGRESS'));
    const stockProduction = items.filter((w) => w.source === 'STOCK' && (w.status === 'ASSIGNED' || w.status === 'IN_PROGRESS' || w.status === 'QUALITY_CHECK'));
    const orderProduction = items.filter((w) => w.source !== 'STOCK' && (w.status === 'ASSIGNED' || w.status === 'IN_PROGRESS' || w.status === 'QUALITY_CHECK'));

    const activeWorkerIds = new Set(active.filter((w) => w.carpenterId).map((w) => w.carpenterId));

    const materialsUsedTodayCount = await this.prisma.stockMovement.count({
      where: { type: 'OUT', date: { gte: startOfToday }, workItemId: { not: null } },
    });

    const perStagePending: Record<Stage, number> = { CARPENTER: 0, CARVING: 0, POLISH: 0 };
    for (const w of active) {
      if (w.stage in perStagePending) perStagePending[w.stage as Stage] += 1;
    }

    const strip = (w: (typeof items)[number]) => stripWorkItemMoney(w, false);

    return {
      kpis: {
        activeWorkers: activeWorkerIds.size,
        jobsInProgress: items.filter((w) => w.status === 'IN_PROGRESS').length,
        pendingByStage: perStagePending,
        readyForVerification: readyForVerification.length,
        stockProductionToday: todaysWork.filter((w) => w.source === 'STOCK').length,
        orderProductionToday: todaysWork.filter((w) => w.source !== 'STOCK').length,
        materialsUsedToday: materialsUsedTodayCount,
        completedToday: completedToday.length,
      },
      groups: {
        todaysWork: todaysWork.map(strip),
        waiting: waiting.map(strip),
        stockProduction: stockProduction.map(strip),
        orderProduction: orderProduction.map(strip),
        completedToday: completedToday.map(strip),
      },
    };
  }

  // --- Payments ------------------------------------------------------------

  async addPayment(carpenterId: string, dto: CreateCarpenterPaymentDto, userId: string) {
    await this.findOneCarpenter(carpenterId);
    await this.prisma.carpenterPayment.create({
      data: {
        carpenterId,
        date: new Date(dto.date),
        amount: dto.amount,
        mode: dto.mode,
        note: dto.note,
        createdById: userId,
      },
    });
    return this.findOneCarpenter(carpenterId);
  }

  async removePayment(carpenterId: string, paymentId: string) {
    const payment = await this.prisma.carpenterPayment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.carpenterId !== carpenterId) throw new NotFoundException('Payment not found');
    await this.prisma.carpenterPayment.delete({ where: { id: paymentId } });
    return this.findOneCarpenter(carpenterId);
  }
}
