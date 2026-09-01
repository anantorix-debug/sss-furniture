import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AuditService } from '../audit/audit.service';
import { CreateCarpenterDto } from './dto/create-carpenter.dto';
import { UpdateCarpenterDto } from './dto/update-carpenter.dto';
import { CreateWorkItemDto } from './dto/create-work-item.dto';
import { UpdateWorkItemDto } from './dto/update-work-item.dto';
import { CreateCarpenterPaymentDto } from './dto/create-carpenter-payment.dto';
import { Role } from '../common/enums/role.enum';

const HIDE_FINANCIALS_FOR: Role[] = [Role.CARPENTER, Role.POLISHER];

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
  ) {}

  // --- Carpenters ------------------------------------------------------

  async findAllCarpenters(params: { workerType?: string; viewerRole?: Role } = {}) {
    const hide = params.viewerRole ? HIDE_FINANCIALS_FOR.includes(params.viewerRole) : false;
    const carpenters = await this.prisma.carpenter.findMany({
      where: { workerType: params.workerType as any },
      include: { workItems: true, payments: true },
      orderBy: { name: 'asc' },
    });
    return carpenters.map((c) => {
      const totalWorkValue = c.workItems.reduce((sum, w) => sum + Number(w.total), 0);
      const totalPaid = c.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        workerType: c.workerType,
        workItemCount: c.workItems.length,
        ...(hide ? {} : { totalWorkValue, totalPaid, balance: totalWorkValue - totalPaid }),
      };
    });
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
    return this.prisma.carpenter.create({ data: dto });
  }

  async updateCarpenter(id: string, dto: UpdateCarpenterDto) {
    await this.findOneCarpenter(id);
    return this.prisma.carpenter.update({ where: { id }, data: dto });
  }

  async removeCarpenter(id: string) {
    await this.findOneCarpenter(id);
    await this.prisma.carpenter.delete({ where: { id } });
    return { success: true };
  }

  // --- Work items --------------------------------------------------------

  async findAllWorkItems(params: { carpenterId?: string; workerType?: string; viewerRole?: Role }) {
    const hide = params.viewerRole ? HIDE_FINANCIALS_FOR.includes(params.viewerRole) : false;
    const items = await this.prisma.carpenterWorkItem.findMany({
      where: {
        carpenterId: params.carpenterId,
        carpenter: params.workerType ? { workerType: params.workerType as any } : undefined,
      },
      include: {
        carpenter: { select: { id: true, name: true, phone: true, workerType: true } },
        createdBy: { select: { name: true } },
        stockMovements: { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } },
      },
      orderBy: { workDate: 'desc' },
    });
    return items.map((w) => stripWorkItemMoney(w, hide));
  }

  async createWorkItem(dto: CreateWorkItemDto, userId: string) {
    const workItem = await this.prisma.carpenterWorkItem.create({
      data: {
        carpenterId: dto.carpenterId,
        stage: dto.stage,
        workDate: new Date(dto.workDate),
        modelNo: dto.modelNo,
        productName: dto.productName,
        category: dto.category,
        size: dto.size,
        price: dto.price,
        extra: dto.extra ?? 0,
        quantity: dto.quantity ?? 1,
        total: dto.total,
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

    let whatsapp: { sent: boolean; reason?: string } | undefined;
    if (dto.notifyWhatsapp !== false && workItem.carpenter) {
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

  async updateWorkItem(id: string, dto: UpdateWorkItemDto) {
    const existing = await this.prisma.carpenterWorkItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Work item not found');

    const previousCarpenterId = existing.carpenterId;

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
        total: dto.total,
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

  async updateWorkStatus(id: string, dto: { status: string; qcNote?: string }, viewerRole?: Role, userId?: string) {
    const existing = await this.prisma.carpenterWorkItem.findUnique({
      where: { id },
      include: { carpenter: { select: { name: true } } },
    });
    if (!existing) throw new NotFoundException('Work item not found');

    await this.prisma.carpenterWorkItem.update({
      where: { id },
      data: { status: dto.status as any, qcNote: dto.qcNote },
    });

    // Notify Super Admin exactly once per genuine transition into
    // COMPLETED - not on every re-save while it's already completed. The
    // hand-off to the next stage (e.g. Carpenter -> Carving) stays manual;
    // this just makes sure Super Admin knows a stage finished.
    if (dto.status === 'COMPLETED' && existing.status !== 'COMPLETED') {
      await this.audit.log({
        userId,
        action: 'WORK_ITEM_COMPLETED',
        targetType: 'CarpenterWorkItem',
        targetId: id,
        metadata: {
          stage: existing.stage,
          modelNo: existing.modelNo,
          productName: existing.productName,
          carpenterName: existing.carpenter?.name,
        },
      });
    }

    return this.findOneWorkItem(id, viewerRole);
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
