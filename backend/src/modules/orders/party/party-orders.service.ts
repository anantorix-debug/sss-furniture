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
    }[],
  ) =>
    items
      .map(
        (i) =>
          `${i.productId ?? ''}|${i.productName}|${i.finish ?? ''}|${i.size ?? ''}|${i.sizeUnit ?? ''}|${i.color ?? ''}|${i.pattern ?? ''}|${i.details ?? ''}|${i.qty ?? 1}|${Number(i.unitPrice)}|${i.modelNo ?? ''}`,
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

const itemsInclude = { items: { orderBy: { createdAt: 'asc' as const } } };

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
  async findAll(params: { status?: string; search?: string; viewerRole?: Role; page?: number; limit?: number }) {
    const hide = params.viewerRole ? HIDE_FINANCIALS_FOR.includes(params.viewerRole) : false;
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = {
      deliveryStatus: params.status ? (params.status as any) : undefined,
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
    const [orders, total] = await Promise.all([
      this.prisma.partyOrder.findMany({
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
        ...(paginated ? toSkipTake(page, limit) : {}),
      }),
      paginated ? this.prisma.partyOrder.count({ where }) : Promise.resolve(0),
    ]);
    const mapped = orders.map((o) => stripOrderMoney(withBalance(o), hide));
    return paginated ? paginate(mapped, total, page, limit) : mapped;
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

  async update(id: string, dto: UpdatePartyOrderDto, userId: string) {
    const current = await this.findOne(id);
    const usingItems = Boolean(dto.items?.length) && itemsDiffer(current.items ?? [], dto.items!);

    if (usingItems) {
      // Release every existing line's stock/production before replacing
      // them - refuses (ConflictException) if any line is already
      // dispatched or in progress, rather than reallocating on top of
      // work that's already started.
      const oldItems = await this.prisma.partyOrderItem.findMany({ where: { orderId: id } });
      for (const item of oldItems) {
        await this.stockAllocation.release({ sourcePartyOrderItemId: item.id, userId });
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

  async remove(id: string, userId: string) {
    await this.findOne(id);
    const items = await this.prisma.partyOrderItem.findMany({ where: { orderId: id } });
    // Release each line's reservation/production before deleting the order
    // - throws if any of it is already dispatched or in progress.
    for (const item of items) {
      await this.stockAllocation.release({ sourcePartyOrderItemId: item.id, userId });
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
    return this.findOne(orderId);
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

  // Matches CustomerOrdersService.buildPdfHtml - same branded "BILL &
  // PAYMENT / ORDER CONFIRMATION" template, adapted for Party Order fields
  // (shopName instead of customerName, no per-line category so each box is
  // titled by the product name itself, and finish/pattern/details shown
  // alongside size/colour when present).
  private buildPdfHtml(order: Awaited<ReturnType<PartyOrdersService['findOne']>>): string {
    const lines: { label: string; qty: number; total: number; details: string[] }[] = order.items.length
      ? order.items.map((i) => ({
          label: i.productName,
          qty: i.qty,
          total: i.qty * Number(i.unitPrice ?? 0),
          details: [
            i.modelNo ? `Model No : ${i.modelNo}` : null,
            i.finish ? `Finish : ${i.finish}` : null,
            i.size ? `Size : ${i.size}${i.sizeUnit ? ` ${i.sizeUnit}` : ''}` : null,
            i.pattern ? `Pattern : ${i.pattern}` : null,
            i.color ? `Colour : ${i.color}` : null,
            i.details ? `Details : ${i.details}` : null,
            `Quantity : ${i.qty}`,
            i.unitPrice != null ? `Price : ₹${Number(i.unitPrice).toLocaleString('en-IN')}/-` : null,
          ].filter((d): d is string => d !== null),
        }))
      : [
          {
            label: order.model ?? 'Order',
            qty: order.qty ?? 1,
            total: Number(order.totalAmount ?? 0),
            details: [`Product : ${order.model ?? '-'}`, `Price : ₹${Number(order.totalAmount ?? 0).toLocaleString('en-IN')}/-`],
          },
        ];

    const itemBoxes = lines
      .map(
        (l) => `
        <div class="item-box">
          <div class="item-title">${escapeHtml(l.label.toUpperCase())}</div>
          <ul>${l.details.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>
        </div>`,
      )
      .join('');

    const summaryRows = lines
      .map(
        (l, i) => `<tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(l.label)}${l.qty > 1 ? ` (${l.qty} Nos)` : ''}</td>
          <td style="text-align:right">₹${l.total.toLocaleString('en-IN')}/-</td>
        </tr>`,
      )
      .join('');

    const latestPayment = order.payments && order.payments.length > 0 ? order.payments[order.payments.length - 1] : null;
    const paymentMode = latestPayment?.mode || 'Cash / Bank';

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #2b2b2b; margin: 0; background: #fff; }
  .banner { width: 100%; display: block; }
  .body { padding: 20px 28px 28px; }
  .title-row { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 6px; break-inside: avoid; page-break-inside: avoid; }
  .title h1 { margin: 0; font-size: 26px; letter-spacing: 0.5px; }
  .title h1 .accent { color: #80011f; }
  .title p { margin: 2px 0 0; font-size: 12px; letter-spacing: 3px; color: #80011f; font-weight: bold; }
  .meta-box { border: 1px solid #c9a227; border-radius: 6px; padding: 10px 16px; font-size: 12px; text-align: left; min-width: 220px; }
  .meta-box div { margin: 2px 0; }
  .meta-box b { display: inline-block; width: 100px; }
  .greeting { margin: 18px 0 4px; font-size: 14px; }
  .greeting .name { font-weight: bold; }
  .item-box { border: 1px solid #e3d9c6; border-radius: 6px; margin-top: 12px; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
  .item-title { background: #80011f; color: #fff; font-weight: bold; font-size: 12.5px; letter-spacing: 0.5px; padding: 7px 14px; }
  .item-box ul { list-style: none; margin: 0; padding: 8px 16px 10px; font-size: 12.5px; }
  .item-box li { padding: 2px 0; }
  .summary-section { break-inside: avoid; page-break-inside: avoid; margin-top: 20px; }
  .summary-title { background: #80011f; color: #fff; font-weight: bold; font-size: 12.5px; letter-spacing: 0.5px; padding: 7px 14px; border-radius: 6px 6px 0 0; }
  table.summary { width: 100%; border-collapse: collapse; font-size: 12.5px; border: 1px solid #e3d9c6; border-top: none; }
  table.summary th { background: #f4f2ec; text-align: left; padding: 8px 14px; border-bottom: 1px solid #e3d9c6; }
  table.summary td { padding: 8px 14px; border-bottom: 1px solid #efede6; }
  table.summary tr { break-inside: avoid; page-break-inside: avoid; }
  .grand-total td { font-weight: bold; font-size: 14px; background: #f1e4c0; border-top: 2px solid #c9a227; }
  .thanks { text-align: center; margin-top: 22px; font-size: 12px; color: #6b6b6b; break-inside: avoid; page-break-inside: avoid; }
  .thanks strong { color: #80011f; }
</style></head>
<body>
  <img class="banner" src="${getPdfBannerDataUri()}" alt="SSS Furniture" />
  <div class="body">
    <div class="title-row">
      <div class="title">
        <h1>BILL <span class="accent">&amp; PAYMENT</span></h1>
        <p>ORDER CONFIRMATION</p>
      </div>
      <div class="meta-box">
        <div><b>Invoice No</b> : ${escapeHtml(order.jobNumber ?? order.cotNo ?? order.id)}</div>
        <div><b>Date</b> : ${order.orderDate.toLocaleDateString('en-IN')}</div>
        <div><b>Payment Mode</b> : ${escapeHtml(paymentMode)}</div>
      </div>
    </div>

    <p class="greeting">Dear <span class="name">${escapeHtml(order.shopName)}</span>,<br/>Kindly check and confirm the following order details:</p>

    ${itemBoxes}

    <div class="summary-section">
      <div class="summary-title">PAYMENT SUMMARY</div>
      <table class="summary">
        <thead><tr><th style="width:40px">S.No</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>
          ${summaryRows}
          <tr class="grand-total"><td colspan="2" style="text-align:right">GRAND TOTAL</td><td style="text-align:right">₹${Number(order.totalAmount ?? 0).toLocaleString('en-IN')}/-</td></tr>
        </tbody>
      </table>
    </div>

    <p class="thanks"><strong>Thank you</strong> for your trust and support - SSS Furniture</p>
  </div>
</body></html>`;
  }

  async generatePdf(id: string): Promise<Buffer> {
    const order = await this.findOne(id);
    return this.pdf.renderHtmlToPdf(this.buildPdfHtml(order));
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
}
