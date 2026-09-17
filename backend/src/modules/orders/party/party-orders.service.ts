import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { StockAllocationService } from '../../inventory/products/stock-allocation.service';
import { CarpenterService } from '../../carpenter/carpenter.service';
import { PdfService } from '../../pdf/pdf.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { CreatePartyOrderDto, PartyOrderItemDto } from './dto/create-party-order.dto';
import { UpdatePartyOrderDto } from './dto/update-party-order.dto';
import { CreatePaymentDto } from '../customer/dto/create-payment.dto';
import { AssignEmployeeDto } from '../customer/dto/assign-employee.dto';
import { AssignProductionDto } from '../customer/dto/assign-production.dto';
import { UpdateModelNoDto } from '../customer/dto/update-model-no.dto';
import { computeBalance, suggestPaymentType } from '../../../common/utils/balance.util';
import { generateJobNumber } from '../../../common/utils/job-number.util';
import { paginate, toSkipTake } from '../../../common/utils/pagination.util';
import { getPdfBannerDataUri } from '../../../common/utils/pdf-banner.util';
import { galleryImageDataUri } from '../../../common/utils/gallery-image-data-uri.util';
import { REPORT_PDF_STYLES, renderReportHeader, renderFilterSummary, renderGeneratedFooter } from '../../../common/utils/pdf-report.util';
import { Role } from '../../../common/enums/role.enum';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

// Order-insensitive comparison of the saved lines against a submitted
// items[] payload - the Edit form always sends the full array (even lines
// nobody touched), so "items present" alone can't tell us whether anything
// actually changed. Only a genuine difference should trigger the release/
// reallocate cycle (which also blocks the whole save if any line is
// already dispatched/in-progress - not something an unrelated field
// change like Delivery Status should ever trigger).
function itemsDiffer(
  current: {
    productId?: string | null;
    productName: string;
    finish?: string | null;
    size?: string | null;
    sizeUnit?: string | null;
    color?: string | null;
    pattern?: string | null;
    details?: string | null;
    qty: number;
    unitPrice: number | string;
    modelNo?: string | null;
    referenceImageId?: string | null;
  }[],
  incoming: PartyOrderItemDto[],
): boolean {
  const serialize = (
    items: {
      productId?: string | null;
      productName: string;
      finish?: string | null;
      size?: string | null;
      sizeUnit?: string | null;
      color?: string | null;
      pattern?: string | null;
      details?: string | null;
      qty?: number;
      unitPrice: number | string;
      modelNo?: string | null;
      referenceImageId?: string | null;
    }[],
  ) =>
    items
      .map(
        (i) =>
          `${i.productId ?? ''}|${i.productName}|${i.finish ?? ''}|${i.size ?? ''}|${i.sizeUnit ?? ''}|${i.color ?? ''}|${i.pattern ?? ''}|${i.details ?? ''}|${i.qty ?? 1}|${Number(i.unitPrice)}|${i.modelNo ?? ''}|${i.referenceImageId ?? ''}`,
      )
      .sort()
      .join(';');
  return serialize(current) !== serialize(incoming);
}

function withBalance<T extends { totalAmount: any; payments: { amount: any }[] }>(order: T) {
  const { totalReceived: receivedAmount, balanceAmount } = computeBalance(order.totalAmount, order.payments);
  return { ...order, receivedAmount, balanceAmount };
}

const HIDE_FINANCIALS_FOR: Role[] = [Role.CARPENTER, Role.CARVER, Role.POLISHER];

// Same rule as CustomerOrdersService: Carpenter/Polisher never see order
// financials, only a non-monetary SETTLED/DUE flag. Line-item prices are
// stripped the same way CustomerOrdersService strips CustomerOrderItem.unitPrice.
function stripOrderMoney<
  T extends { price: any; totalAmount: any; payments: any; receivedAmount: any; balanceAmount: any; items?: { unitPrice: any; totalValue: any }[] },
>(order: T, hide: boolean) {
  if (!hide) return order;
  const { price, totalAmount, payments, receivedAmount, balanceAmount, items, ...rest } = order as any;
  return {
    ...rest,
    paymentStatus: balanceAmount <= 0 ? 'SETTLED' : 'DUE',
    items: items?.map(({ unitPrice, totalValue, ...i }: any) => i),
  };
}

const itemsInclude = { items: { orderBy: { createdAt: 'asc' as const }, include: { referenceImage: true } } };

@Injectable()
export class PartyOrdersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private stockAllocation: StockAllocationService,
    private carpenter: CarpenterService,
    private pdf: PdfService,
    private whatsapp: WhatsappService,
  ) {}

  // Opt-in pagination - see the identical note on CustomerOrdersService.findAll.
  // `paymentStatus` is derived from receivedAmount/balanceAmount, not a
  // stored column - filtered/paginated in JS after computing it, same
  // "compute then filter" pattern as RawMaterial's isLow (paginating in SQL
  // first would drop matching rows before the derived filter runs).
  async findAll(params: {
    status?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    shopId?: string;
    paymentStatus?: 'SETTLED' | 'DUE';
    viewerRole?: Role;
    page?: number;
    limit?: number;
  }) {
    const hide = params.viewerRole ? HIDE_FINANCIALS_FOR.includes(params.viewerRole) : false;
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = {
      deliveryStatus: params.status ? (params.status as any) : undefined,
      shopId: params.shopId,
      orderDate:
        params.dateFrom || params.dateTo
          ? { gte: params.dateFrom ? new Date(params.dateFrom) : undefined, lte: params.dateTo ? new Date(params.dateTo) : undefined }
          : undefined,
      OR: params.search
        ? [
            { shopName: { contains: params.search } },
            { model: { contains: params.search } },
            { phone: { contains: params.search } },
            { cotNo: { contains: params.search } },
            { items: { some: { productName: { contains: params.search } } } },
          ]
        : undefined,
    };
    const orders = await this.prisma.partyOrder.findMany({
      where,
      include: {
        payments: true,
        ...itemsInclude,
        createdBy: { select: { id: true, name: true } },
        assignedEmployee: { select: { id: true, name: true } },
        assignedBy: { select: { id: true, name: true } },
        modelNoUpdatedBy: { select: { id: true, name: true } },
      },
      orderBy: { orderDate: 'desc' },
    });
    const withStatus = orders.map((o) => {
      const balanced = withBalance(o);
      return { ...balanced, paymentStatus: (balanced.balanceAmount <= 0 ? 'SETTLED' : 'DUE') as 'SETTLED' | 'DUE' };
    });
    const filtered = params.paymentStatus ? withStatus.filter((o) => o.paymentStatus === params.paymentStatus) : withStatus;
    const mapped = filtered.map((o) => stripOrderMoney(o, hide));

    if (!paginated) return mapped;
    const { skip, take } = toSkipTake(page, limit);
    return paginate(mapped.slice(skip, skip + take), mapped.length, page, limit);
  }

  async findOne(id: string, viewerRole?: Role) {
    const hide = viewerRole ? HIDE_FINANCIALS_FOR.includes(viewerRole) : false;
    const order = await this.prisma.partyOrder.findUnique({
      where: { id },
      include: {
        payments: { orderBy: { date: 'asc' } },
        ...itemsInclude,
        createdBy: { select: { id: true, name: true } },
        assignedEmployee: { select: { id: true, name: true } },
        assignedBy: { select: { id: true, name: true } },
        modelNoUpdatedBy: { select: { id: true, name: true } },
      },
    });
    if (!order) throw new NotFoundException('Party order not found');
    return stripOrderMoney(withBalance(order), hide);
  }

  private lineTotal(i: PartyOrderItemDto) {
    return (i.qty ?? 1) * i.unitPrice;
  }

  async create(dto: CreatePartyOrderDto, userId: string) {
    const shop = await this.prisma.shop.findUnique({ where: { id: dto.shopId } });
    if (!shop) throw new NotFoundException('Shop not found');

    const jobNumber = await generateJobNumber(this.prisma);
    const totalAmount = dto.items.reduce((sum, i) => sum + this.lineTotal(i), 0);

    const order = await this.prisma.partyOrder.create({
      data: {
        jobNumber,
        orderDate: new Date(dto.orderDate),
        shopName: shop.name,
        shopId: shop.id,
        phone: dto.phone,
        totalAmount,
        courierTrack: dto.courierTrack,
        actualDeliveryDate: dto.actualDeliveryDate ? new Date(dto.actualDeliveryDate) : undefined,
        deliveryStatus: dto.deliveryStatus,
        createdById: userId,
        items: {
          create: dto.items.map((i) => ({
            productId: i.productId,
            productName: i.productName,
            finish: i.finish,
            size: i.size,
            sizeUnit: i.sizeUnit,
            color: i.color,
            pattern: i.pattern,
            details: i.details,
            qty: i.qty ?? 1,
            unitPrice: i.unitPrice,
            totalValue: this.lineTotal(i),
            modelNo: i.modelNo,
            referenceImageId: i.referenceImageId,
          })),
        },
      },
      include: { payments: true, ...itemsInclude },
    });

    await this.allocateItems(order.jobNumber ?? order.id, order.items, userId);

    await this.audit.log({
      userId,
      action: 'PARTY_ORDER_CREATED',
      targetType: 'PartyOrder',
      targetId: order.id,
      metadata: { shopName: order.shopName, itemCount: order.items.length, totalAmount },
    });

    return this.findOne(order.id);
  }

  // Stock-first split per line - see StockAllocationService. Runs after
  // the order/items exist so each line's real id can be the source key.
  private async allocateItems(
    jobNumberForStock: string,
    items: { id: string; productId: string | null; productName: string; size: string | null; color?: string | null; qty: number }[],
    userId: string,
  ) {
    for (const item of items) {
      const result = await this.stockAllocation.allocate({
        productId: item.productId ?? undefined,
        productName: item.productName,
        quantity: item.qty,
        size: item.size ?? undefined,
        color: item.color ?? undefined,
        source: 'PARTY_ORDER',
        sourcePartyOrderItemId: item.id,
        jobNumberForStock,
        userId,
      });
      await this.prisma.partyOrderItem.update({
        where: { id: item.id },
        data: { stockReservedQty: result.stockReservedQty, productionQty: result.productionQty },
      });
    }
  }

  async update(id: string, dto: UpdatePartyOrderDto, userId: string, force = false, viewerRole?: Role) {
    const current = await this.findOne(id);
    const usingItems = Boolean(dto.items?.length) && itemsDiffer(current.items ?? [], dto.items!);

    // force is only ever honored for SUPERADMIN - Admin still gets the
    // normal safety block even if a stale/tampered request sends force=true.
    const effectiveForce = force && viewerRole === Role.SUPERADMIN;
    if (force && !effectiveForce) {
      throw new ForbiddenException('Only Super Admin can force this change through');
    }

    if (usingItems) {
      // Release every existing line's stock/production before replacing
      // them - refuses (ConflictException) if any line is already
      // dispatched or in progress, rather than reallocating on top of
      // work that's already started. effectiveForce skips the "already in
      // progress" block, never the dispatched one - see
      // StockAllocationService.release.
      const oldItems = await this.prisma.partyOrderItem.findMany({ where: { orderId: id } });
      for (const item of oldItems) {
        await this.stockAllocation.release({ sourcePartyOrderItemId: item.id, userId, force: effectiveForce });
      }
      if (effectiveForce) {
        await this.audit.log({
          userId,
          action: 'FORCE_EDIT_PARTY_ORDER_ITEMS',
          targetType: 'PartyOrder',
          targetId: id,
          metadata: { shopName: current.shopName },
        });
      }
      await this.prisma.partyOrderItem.deleteMany({ where: { orderId: id } });
    }

    let shop: { id: string; name: string } | null = null;
    if (dto.shopId) {
      shop = await this.prisma.shop.findUnique({ where: { id: dto.shopId } });
      if (!shop) throw new NotFoundException('Shop not found');
    }

    const order = await this.prisma.partyOrder.update({
      where: { id },
      data: {
        orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
        shopName: shop?.name,
        shopId: shop?.id,
        phone: dto.phone,
        totalAmount: usingItems ? dto.items!.reduce((sum, i) => sum + this.lineTotal(i), 0) : undefined,
        courierTrack: dto.courierTrack,
        actualDeliveryDate: dto.actualDeliveryDate ? new Date(dto.actualDeliveryDate) : undefined,
        deliveryStatus: dto.deliveryStatus,
        items: usingItems
          ? {
              create: dto.items!.map((i) => ({
                productId: i.productId,
                productName: i.productName,
                finish: i.finish,
                size: i.size,
                sizeUnit: i.sizeUnit,
                color: i.color,
                pattern: i.pattern,
                details: i.details,
                qty: i.qty ?? 1,
                unitPrice: i.unitPrice,
                totalValue: this.lineTotal(i),
                modelNo: i.modelNo,
                referenceImageId: i.referenceImageId,
              })),
            }
          : undefined,
      },
      include: { payments: true, ...itemsInclude },
    });

    if (usingItems) {
      await this.allocateItems(order.jobNumber ?? order.id, order.items, userId);
      return this.findOne(order.id);
    }
    return withBalance(order);
  }

  async remove(id: string, userId: string, force = false, viewerRole?: Role) {
    const order = await this.findOne(id);
    const effectiveForce = force && viewerRole === Role.SUPERADMIN;
    if (force && !effectiveForce) {
      throw new ForbiddenException('Only Super Admin can force this delete through');
    }
    const items = await this.prisma.partyOrderItem.findMany({ where: { orderId: id } });
    // Release each line's reservation/production before deleting the order
    // - throws if any of it is already dispatched or in progress.
    // effectiveForce (SUPERADMIN only) skips the "already in progress"
    // block, never the dispatched one - see StockAllocationService.release.
    for (const item of items) {
      await this.stockAllocation.release({ sourcePartyOrderItemId: item.id, userId, force: effectiveForce });
    }
    if (effectiveForce) {
      await this.audit.log({
        userId,
        action: 'FORCE_DELETE_PARTY_ORDER',
        targetType: 'PartyOrder',
        targetId: id,
        metadata: { shopName: order.shopName },
      });
    }
    // Explicit child deletes, not a bare partyOrder.delete() relying on the
    // schema's onDelete: Cascade - confirmed live that no such FK constraint
    // actually exists in MySQL (this project's `prisma db push` history
    // doesn't guarantee one gets created, same caveat already noted on
    // SuppliersService.remove), so relying on it silently orphaned payments
    // and items, which then crashed any full-table query that includes the
    // (required, non-optional) order relation - such as the unified
    // Payments ledger.
    await this.prisma.$transaction([
      this.prisma.partyOrderPayment.deleteMany({ where: { orderId: id } }),
      this.prisma.partyOrderItem.deleteMany({ where: { orderId: id } }),
      this.prisma.partyOrder.delete({ where: { id } }),
    ]);
    return { success: true };
  }

  async addPayment(orderId: string, dto: CreatePaymentDto, userId: string) {
    const existing = await this.findOne(orderId);
    const type = dto.type ?? suggestPaymentType(Number(existing.totalAmount), existing.payments, dto.amount);
    await this.prisma.partyOrderPayment.create({
      data: {
        orderId,
        date: new Date(dto.date),
        amount: dto.amount,
        type,
        mode: dto.mode,
        note: dto.note,
        createdById: userId,
      },
    });
    await this.autoMarkDeliveredIfPaid(orderId);
    return this.findOne(orderId);
  }

  // Same auto-advance as CustomerOrdersService.autoMarkDeliveredIfPaid -
  // clearing the balance implies delivered, but only from PENDING/
  // OUT_FOR_DELIVERY, never overriding a CANCELLED or failed delivery.
  private async autoMarkDeliveredIfPaid(orderId: string) {
    const order = await this.prisma.partyOrder.findUnique({
      where: { id: orderId },
      include: { payments: true },
    });
    if (!order) return;
    const { balanceAmount } = computeBalance(Number(order.totalAmount), order.payments);
    if (balanceAmount <= 0 && (order.deliveryStatus === 'PENDING' || order.deliveryStatus === 'OUT_FOR_DELIVERY')) {
      await this.prisma.partyOrder.update({ where: { id: orderId }, data: { deliveryStatus: 'DELIVERED' } });
    }
  }

  async removePayment(orderId: string, paymentId: string) {
    const payment = await this.prisma.partyOrderPayment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.orderId !== orderId) throw new NotFoundException('Payment not found');
    await this.prisma.partyOrderPayment.delete({ where: { id: paymentId } });
    return this.findOne(orderId);
  }

  // Per-line Model No entry - kept alongside the legacy order-level
  // updateModelNo() below (which stays valid for old single-product rows).
  // ADMIN-gated: unlike CustomerOrder/legacy PartyOrder, a line has no
  // assignedEmployeeId to check against, and the primary Model No entry
  // path for new orders is CarpenterService.updateWorkItemModelNo, which
  // propagates here automatically once a linked work item is completed.
  async updateItemModelNo(orderId: string, itemId: string, modelNo: string, userId: string) {
    const item = await this.prisma.partyOrderItem.findUnique({ where: { id: itemId } });
    if (!item || item.orderId !== orderId) throw new NotFoundException('Party order line not found');

    const trimmed = modelNo.trim();
    if (!trimmed) throw new BadRequestException('Model No cannot be empty');

    await this.prisma.partyOrderItem.update({
      where: { id: itemId },
      data: { modelNo: trimmed, modelNoUpdatedById: userId, modelNoUpdatedAt: new Date() },
    });

    await this.audit.log({
      userId,
      action: 'MODEL_NO_UPDATED',
      targetType: 'PartyOrderItem',
      targetId: itemId,
      metadata: { orderType: 'PARTY_ORDER', orderId, productName: item.productName, modelNo: trimmed },
    });

    return this.findOne(orderId);
  }

  // Unified "Assign to Production" for one line of a multi-product Party
  // Order - same shape as CustomerOrdersService.assignProduction, tagging
  // the work item with this line so completion feeds a FinishedStockItem
  // (never Godown Stock) and stays traceable back to the order.
  async assignItemProduction(orderId: string, itemId: string, dto: AssignProductionDto, userId: string, viewerRole?: Role) {
    const item = await this.prisma.partyOrderItem.findUnique({ where: { id: itemId }, include: { order: true } });
    if (!item || item.orderId !== orderId) throw new NotFoundException('Party order line not found');

    if (dto.employeeUserId) {
      const employee = await this.prisma.user.findUnique({ where: { id: dto.employeeUserId } });
      if (!employee || (employee.role !== Role.CARPENTER && employee.role !== Role.CARVER && employee.role !== Role.POLISHER)) {
        throw new BadRequestException('Employee must be an active Carpenter, Carving or Polish team user');
      }
      await this.prisma.partyOrder.update({
        where: { id: orderId },
        data: { assignedEmployeeId: employee.id, assignedAt: new Date(), assignedById: userId },
      });
    }

    const quantity = dto.quantity ?? item.productionQty ?? 1;
    const extra = dto.extra ?? 0;
    const price = dto.price ?? 0;
    const total = price * quantity + extra;

    await this.carpenter.assignSourceProduction(
      { source: 'PARTY_ORDER', sourcePartyOrderItemId: itemId, assignedById: userId },
      {
        carpenterId: dto.carpenterId,
        stage: dto.stage as any,
        workDate: dto.workDate,
        modelNo: item.modelNo ?? undefined,
        productName: item.productName,
        category: dto.category,
        size: dto.size ?? item.size ?? undefined,
        sizeUnit: dto.sizeUnit ?? item.sizeUnit ?? undefined,
        price,
        extra,
        quantity,
        total,
        productId: item.productId ?? undefined,
        notes: dto.notes,
        notifyWhatsapp: dto.notifyWhatsapp,
        color: dto.color,
      },
      userId,
      viewerRole,
    );

    return this.findOne(orderId);
  }

  // --- Legacy single-product endpoints ------------------------------
  // Kept for old rows created before the multi-line redesign, which still
  // carry data in PartyOrder.model/cotNo/assignedEmployeeId directly.
  // Unchanged from the pre-redesign implementation.

  async assignEmployee(id: string, dto: AssignEmployeeDto, assignedById: string) {
    await this.findOne(id);
    const employee = await this.prisma.user.findUnique({ where: { id: dto.employeeId } });
    if (!employee || (employee.role !== Role.CARPENTER && employee.role !== Role.CARVER && employee.role !== Role.POLISHER)) {
      throw new BadRequestException('Employee must be an active Carpenter, Carving or Polish team user');
    }
    await this.prisma.partyOrder.update({
      where: { id },
      data: { assignedEmployeeId: employee.id, assignedAt: new Date(), assignedById },
    });
    return this.findOne(id);
  }

  async updateModelNo(id: string, dto: UpdateModelNoDto, user: AuthUser) {
    const order = await this.findOne(id);
    if (user.role !== Role.SUPERADMIN && (order as any).assignedEmployeeId !== user.userId) {
      throw new ForbiddenException('This order is not assigned to you');
    }
    const modelNo = dto.modelNo.trim();
    if (!modelNo) throw new BadRequestException('Model No cannot be empty');

    const previousModelNo = (order as any).cotNo;
    const updated = await this.prisma.partyOrder.update({
      where: { id },
      data: { cotNo: modelNo, modelNoUpdatedById: user.userId, modelNoUpdatedAt: new Date() },
    });

    const employee = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { name: true } });
    await this.audit.log({
      userId: user.userId,
      action: 'MODEL_NO_UPDATED',
      targetType: 'PartyOrder',
      targetId: id,
      metadata: {
        orderType: 'PARTY_ORDER',
        orderId: order.id,
        shopName: order.shopName,
        previousModelNo,
        modelNo,
        employeeName: employee?.name,
      },
    });

    return this.findOne(updated.id, user.role as Role);
  }

  // "Product Supply Details" style report - a real per-item table (not the
  // old free-text "item box" bill) matching how wholesale/dealer order
  // information is traditionally presented on paper, modernized with the
  // shop's existing banner/branding. One template for both Download PDF
  // and Send PDF via WhatsApp - not two.
  private buildPdfHtml(order: Awaited<ReturnType<PartyOrdersService['findOne']>>, recipientType: 'customer' | 'employee' = 'customer'): string {
    const isEmployee = recipientType === 'employee';
    const lines = order.items.length
      ? order.items.map((i) => ({
          date: order.orderDate,
          order: i.productName,
          finish: i.finish ?? '-',
          size: [i.size, i.sizeUnit].filter(Boolean).join(' ') || '-',
          pattern: i.pattern ?? '-',
          price: i.unitPrice != null ? Number(i.unitPrice) : null,
          modelNo: i.modelNo ?? '-',
          value: i.totalValue != null ? Number(i.totalValue) : (i.qty ?? 1) * Number(i.unitPrice ?? 0),
          imageUrl: i.referenceImage?.url ?? null,
        }))
      : [
          {
            date: order.orderDate,
            order: order.model ?? 'Order',
            finish: order.finish ?? '-',
            size: [order.size, order.sizeUnit].filter(Boolean).join(' ') || '-',
            pattern: '-',
            price: order.price != null ? Number(order.price) : null,
            modelNo: order.cotNo ?? '-',
            value: Number(order.totalAmount ?? 0),
            imageUrl: null,
          },
        ];

    const rows = lines
      .map((l, idx) => {
        const dataUri = l.imageUrl ? galleryImageDataUri(l.imageUrl) : null;
        return `<tr>
          <td>${idx + 1}</td>
          <td>${dataUri ? `<img class="row-photo" src="${dataUri}" alt="${escapeHtml(l.order)}" />` : '-'}</td>
          <td>${l.date.toLocaleDateString('en-IN')}</td>
          <td>${escapeHtml(l.order)}</td>
          <td>${escapeHtml(l.finish)}</td>
          <td>${escapeHtml(l.size)}</td>
          <td>${escapeHtml(l.pattern)}</td>
          ${isEmployee ? '' : `<td style="text-align:right">${l.price != null ? `₹${l.price.toLocaleString('en-IN')}` : '-'}</td>`}
          <td>${escapeHtml(l.modelNo)}</td>
          ${isEmployee ? '' : `<td style="text-align:right">₹${l.value.toLocaleString('en-IN')}</td>`}
        </tr>`;
      })
      .join('');

    const totalOrderValue = Number(order.totalAmount ?? 0);
    const received = Number((order as any).receivedAmount ?? 0);
    const balance = Number((order as any).balanceAmount ?? totalOrderValue - received);

    const deliveryBlock =
      order.courierTrack || order.actualDeliveryDate
        ? `<div style="margin-top:18px">
             <h3 style="font-size:13px;margin:0 0 8px">Delivery Details</h3>
             <p style="font-size:12px;color:#374151;margin:0">
               ${order.courierTrack ? `Vehicle Number: ${escapeHtml(order.courierTrack)}<br/>` : ''}
               ${order.actualDeliveryDate ? `Actual Delivery Date: ${order.actualDeliveryDate.toLocaleDateString('en-IN')}<br/>` : ''}
               Delivery Status: ${escapeHtml(String(order.deliveryStatus).replace(/_/g, ' '))}
             </p>
           </div>`
        : '';

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2933; margin: 0; background: #fff; }
  .banner { width: 100%; display: block; }
  .body { padding: 20px 28px 28px; }
  .title { text-align: center; margin: 10px 0 18px; }
  .title h1 { margin: 0; font-size: 20px; letter-spacing: 1px; color: #80011f; }
  .title p { margin: 2px 0 0; font-size: 12px; letter-spacing: 2px; color: #6b7280; font-weight: bold; }
  .meta { display: flex; flex-wrap: wrap; gap: 20px; font-size: 12px; margin-bottom: 16px; }
  .meta div b { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; break-inside: avoid; }
  th { background: #f4f2ec; text-align: left; padding: 7px 9px; border-bottom: 1px solid #e3e1d9; }
  td { padding: 7px 9px; border-bottom: 1px solid #efede6; }
  .row-photo { width: 72px; height: 72px; object-fit: cover; border-radius: 6px; border: 1px solid #e3e1d9; display: block; }
  .summary { display: flex; gap: 20px; margin-top: 18px; }
  .summary div { flex: 1; border: 1px solid #e3e1d9; border-radius: 8px; padding: 10px 14px; }
  .summary .label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; }
  .summary .value { font-size: 16px; font-weight: bold; margin-top: 2px; }
  .thanks { text-align: center; margin-top: 22px; font-size: 12px; color: #6b6b6b; }
  .thanks strong { color: #80011f; }
</style></head>
<body>
  <img class="banner" src="${getPdfBannerDataUri()}" alt="SSS Furniture" />
  <div class="body">
    <div class="title">
      <h1>SSS COMPANY</h1>
      <p>PRODUCT SUPPLY DETAILS</p>
    </div>
    <div class="meta">
      <div><b>Dealer Name</b>${escapeHtml(order.shopName)}</div>
      ${order.phone ? `<div><b>Phone</b>${escapeHtml(order.phone)}</div>` : ''}
      <div><b>Job No</b>${escapeHtml(order.jobNumber ?? order.cotNo ?? order.id)}</div>
      <div><b>Order Date</b>${order.orderDate.toLocaleDateString('en-IN')}</div>
    </div>
    <table>
      <thead>
        <tr><th>S.No</th><th>Photo</th><th>Date</th><th>Order</th><th>Finish</th><th>Size</th><th>Pattern</th>${
          isEmployee ? '' : '<th style="text-align:right">Price</th>'
        }<th>Model No</th>${isEmployee ? '' : '<th style="text-align:right">Value</th>'}</tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${
      isEmployee
        ? ''
        : `<div class="summary">
      <div><div class="label">Total Order Value</div><div class="value">₹${totalOrderValue.toLocaleString('en-IN')}</div></div>
      <div><div class="label">Received</div><div class="value" style="color:#15803d">₹${received.toLocaleString('en-IN')}</div></div>
      <div><div class="label">Balance</div><div class="value" style="color:#b91c1c">₹${balance.toLocaleString('en-IN')}</div></div>
    </div>`
    }
    ${deliveryBlock}
    <p class="thanks"><strong>Thank you</strong> for your trust and support - SSS Furniture</p>
  </div>
</body></html>`;
  }

  async generatePdf(id: string, recipientType: 'customer' | 'employee' = 'customer'): Promise<Buffer> {
    const order = await this.findOne(id);
    return this.pdf.renderHtmlToPdf(this.buildPdfHtml(order, recipientType));
  }

  async sendPdfToShop(id: string) {
    const order = await this.findOne(id);
    if (!order.phone) {
      return { sent: false, reason: 'no_shop_phone' as const };
    }
    const buffer = await this.generatePdf(id);
    return this.whatsapp.sendDocument(order.phone, {
      buffer,
      filename: `Order Confirmation - ${order.jobNumber ?? order.id}.pdf`,
      mimetype: 'application/pdf',
      caption: `Order confirmation ${order.jobNumber ?? ''} - ${order.shopName} - SSS Company`,
    });
  }

  // Party Orders list PDF - exactly the filtered rows the list page is
  // showing, never the whole table.
  async generateListPdf(params: {
    status?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    shopId?: string;
    paymentStatus?: 'SETTLED' | 'DUE';
  }): Promise<Buffer> {
    const orders = (await this.findAll(params)) as any[];
    const rows = orders
      .map(
        (o, idx) => `<tr>
          <td>${idx + 1}</td>
          <td>${escapeHtml(o.jobNumber ?? o.cotNo ?? o.id)}</td>
          <td>${escapeHtml(o.shopName)}</td>
          <td>${new Date(o.orderDate).toLocaleDateString('en-IN')}</td>
          <td>${o.items?.length ?? 0}</td>
          <td style="text-align:right">₹${Number(o.totalAmount ?? 0).toLocaleString('en-IN')}</td>
          <td style="text-align:right">₹${Number(o.receivedAmount ?? 0).toLocaleString('en-IN')}</td>
          <td style="text-align:right">₹${Number(o.balanceAmount ?? 0).toLocaleString('en-IN')}</td>
          <td>${escapeHtml(String(o.deliveryStatus).replace(/_/g, ' '))}</td>
        </tr>`,
      )
      .join('');

    const filterSummary = renderFilterSummary({
      Search: params.search,
      Status: params.status ? params.status.replace(/_/g, ' ') : undefined,
      'Date From': params.dateFrom ? new Date(params.dateFrom).toLocaleDateString('en-IN') : undefined,
      'Date To': params.dateTo ? new Date(params.dateTo).toLocaleDateString('en-IN') : undefined,
      'Payment Status': params.paymentStatus,
    });

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${REPORT_PDF_STYLES}</style></head>
<body>
  ${renderReportHeader('Party Orders')}
  <div class="body">
    ${filterSummary}
    <table>
      <thead><tr><th>S.No</th><th>Job No</th><th>Dealer/Shop</th><th>Date</th><th>Products</th><th style="text-align:right">Total</th><th style="text-align:right">Received</th><th style="text-align:right">Balance</th><th>Status</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:#9ca3af;padding:16px">No party orders found</td></tr>'}</tbody>
    </table>
    ${renderGeneratedFooter(orders.length, 'order')}
  </div>
</body></html>`;
    return this.pdf.renderHtmlToPdf(html);
  }
}
