import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { CreateOrderWorkEntryDto } from './dto/create-order-work-entry.dto';

// Manual, historical log of who worked an order and what it cost - shown
// and entered directly on the Customer/Party Order form itself (spec:
// "don't create a new tab, set it dynamically on the same forms"), not a
// separate page. Entirely independent of the CarpenterWorkItem production
// pipeline: this is a free-text ledger an Admin/Super Admin fills in by
// hand, append-only like a payment ledger (add/remove, never edit in
// place), and it never affects order value, stock, or production status.
@Injectable()
export class OrderWorkEntriesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async listForCustomerOrder(customerOrderId: string) {
    return this.prisma.orderWorkEntry.findMany({ where: { customerOrderId }, orderBy: { workDate: 'desc' } });
  }

  async listForPartyOrder(partyOrderId: string) {
    return this.prisma.orderWorkEntry.findMany({ where: { partyOrderId }, orderBy: { workDate: 'desc' } });
  }

  // Every manually-entered work record across every order, for the
  // Production Control screen's own "Work Entries" tab - a single place to
  // monitor who's been logged as working on what, instead of having to open
  // each order individually. Read-only summary; add/remove still only
  // happens from the order's own form.
  async listAll() {
    const entries = await this.prisma.orderWorkEntry.findMany({
      orderBy: { workDate: 'desc' },
      include: {
        customerOrder: { select: { id: true, orderId: true, customerName: true } },
        partyOrder: { select: { id: true, shopName: true, jobNumber: true } },
      },
    });
    return entries.map((e) => ({
      id: e.id,
      workerName: e.workerName,
      workDescription: e.workDescription,
      workerPrice: e.workerPrice,
      extraPrice: e.extraPrice,
      workDate: e.workDate,
      orderType: e.customerOrderId ? ('CUSTOMER' as const) : ('PARTY' as const),
      orderRef: e.customerOrder
        ? { id: e.customerOrder.id, label: e.customerOrder.orderId, sub: e.customerOrder.customerName }
        : e.partyOrder
          ? { id: e.partyOrder.id, label: e.partyOrder.jobNumber ?? e.partyOrder.shopName, sub: e.partyOrder.shopName }
          : null,
    }));
  }

  async createForCustomerOrder(customerOrderId: string, dto: CreateOrderWorkEntryDto, userId: string) {
    const order = await this.prisma.customerOrder.findUnique({ where: { id: customerOrderId }, select: { id: true, orderId: true } });
    if (!order) throw new NotFoundException('Customer order not found');

    const entry = await this.prisma.orderWorkEntry.create({
      data: {
        customerOrderId,
        workerName: dto.workerName,
        workDescription: dto.workDescription,
        workerPrice: dto.workerPrice,
        extraPrice: dto.extraPrice,
        workDate: new Date(dto.workDate),
        createdById: userId,
      },
    });

    await this.audit.log({
      userId,
      action: 'ORDER_WORK_ENTRY_ADDED',
      targetType: 'CustomerOrder',
      targetId: customerOrderId,
      metadata: { orderId: order.orderId, workerName: dto.workerName, workerPrice: dto.workerPrice, extraPrice: dto.extraPrice },
    });

    return entry;
  }

  async createForPartyOrder(partyOrderId: string, dto: CreateOrderWorkEntryDto, userId: string) {
    const order = await this.prisma.partyOrder.findUnique({ where: { id: partyOrderId }, select: { id: true, shopName: true } });
    if (!order) throw new NotFoundException('Party order not found');

    const entry = await this.prisma.orderWorkEntry.create({
      data: {
        partyOrderId,
        workerName: dto.workerName,
        workDescription: dto.workDescription,
        workerPrice: dto.workerPrice,
        extraPrice: dto.extraPrice,
        workDate: new Date(dto.workDate),
        createdById: userId,
      },
    });

    await this.audit.log({
      userId,
      action: 'ORDER_WORK_ENTRY_ADDED',
      targetType: 'PartyOrder',
      targetId: partyOrderId,
      metadata: { shopName: order.shopName, workerName: dto.workerName, workerPrice: dto.workerPrice, extraPrice: dto.extraPrice },
    });

    return entry;
  }

  async remove(entryId: string, userId: string) {
    const entry = await this.prisma.orderWorkEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Work entry not found');

    await this.prisma.orderWorkEntry.delete({ where: { id: entryId } });

    await this.audit.log({
      userId,
      action: 'ORDER_WORK_ENTRY_REMOVED',
      targetType: entry.customerOrderId ? 'CustomerOrder' : 'PartyOrder',
      targetId: entry.customerOrderId ?? entry.partyOrderId ?? entryId,
      metadata: { workerName: entry.workerName, workerPrice: Number(entry.workerPrice) },
    });

    return { success: true };
  }
}
