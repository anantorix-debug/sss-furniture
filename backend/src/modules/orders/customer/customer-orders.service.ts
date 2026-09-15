import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { CarpenterService } from '../../carpenter/carpenter.service';
import { StockAllocationService } from '../../inventory/products/stock-allocation.service';
import { PdfService } from '../../pdf/pdf.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { CreateCustomerOrderDto, CustomerOrderItemDto } from './dto/create-customer-order.dto';
import { UpdateCustomerOrderDto } from './dto/update-customer-order.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { AssignProductionDto } from './dto/assign-production.dto';
import { AssignEmployeeDto } from './dto/assign-employee.dto';
import { UpdateModelNoDto } from './dto/update-model-no.dto';
import { computeBalance, suggestPaymentType } from '../../../common/utils/balance.util';
import { generateJobNumber } from '../../../common/utils/job-number.util';
import { paginate, toSkipTake } from '../../../common/utils/pagination.util';
import { getPdfBannerDataUri } from '../../../common/utils/pdf-banner.util';
import { Role } from '../../../common/enums/role.enum';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

const HIDE_FINANCIALS_FOR: Role[] = [Role.CARPENTER, Role.POLISHER];

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

// Order-insensitive comparison of the saved lines against a submitted
// items[] payload - the Edit form always sends the full array (even lines
// nobody touched), so "items present" alone can't tell us whether anything
// actually changed. Only a genuine difference should trigger the release/
// reallocate cycle.
function itemsDiffer(
  current: { productId?: string | null; productName: string; category?: string | null; size?: string | null; sizeUnit?: string | null; color?: string | null; quantity: number; unitPrice: number | string }[],
  incoming: CustomerOrderItemDto[],
): boolean {
  const serialize = (
    items: { productId?: string | null; productName: string; category?: string | null; size?: string | null; sizeUnit?: string | null; color?: string | null; quantity?: number; unitPrice: number | string }[],
  ) =>
    items
      .map((i) => `${i.productId ?? ''}|${i.productName}|${i.category ?? ''}|${i.size ?? ''}|${i.sizeUnit ?? ''}|${i.color ?? ''}|${i.quantity ?? 1}|${Number(i.unitPrice)}`)
      .sort()
      .join(';');
  return serialize(current) !== serialize(incoming);
}

function withBalance<T extends { orderValue: any; payments: { amount: any }[] }>(order: T) {
  const { totalReceived, balanceAmount } = computeBalance(order.orderValue, order.payments);
  return { ...order, totalReceived, balanceAmount };
}

// Collapses the join-table rows (CustomerOrderGalleryImage[]) into a plain
// GalleryImage[] for the API response - callers shouldn't need to know the
// join table exists.
function flattenGalleryImages<T extends { galleryImages?: { galleryImage: unknown }[] }>(order: T) {
  if (!order.galleryImages) return order;
  return { ...order, galleryImages: order.galleryImages.map((g) => g.galleryImage) };
}

// Carpenter/Polisher never see order financials - only a non-monetary
// SETTLED/DUE flag survives, matching the pattern already used by
// SearchService and RawMaterialsService for these two roles.
function stripOrderMoney<
  T extends { orderValue: any; payments: any; totalReceived: any; balanceAmount: any; items?: { unitPrice: any }[] },
>(order: T, hide: boolean) {
  if (!hide) return order;
  const { orderValue, payments, totalReceived, balanceAmount, items, ...rest } = order as any;
  return {
    ...rest,
    paymentStatus: balanceAmount <= 0 ? 'SETTLED' : 'DUE',
    items: items?.map(({ unitPrice, ...i }: any) => i),
  };
}

@Injectable()
export class CustomerOrdersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private carpenter: CarpenterService,
    private stockAllocation: StockAllocationService,
    private pdf: PdfService,
    private whatsapp: WhatsappService,
  ) {}

  // When line items are given, they're the source of truth for `product`
  // (a joined summary) and `orderValue` (their sum) - the plain fields stay
  // the single-product path for orders that don't need a line-item list.
  private deriveFromItems(dto: { product?: string; orderValue?: number; items?: CustomerOrderItemDto[] }) {
    if (dto.items && dto.items.length > 0) {
      const product = dto.items.map((i) => i.productName).join(', ');
      const orderValue = dto.items.reduce((sum, i) => sum + i.unitPrice * (i.quantity ?? 1), 0);
      return { product, orderValue };
    }
    if (dto.product === undefined || dto.orderValue === undefined) {
      throw new BadRequestException('Provide either line items or both product and orderValue');
    }
    return { product: dto.product, orderValue: dto.orderValue };
  }

  // Pagination is opt-in: pass `page` to get { data, total, page, limit,
  // totalPages }. Omit it (as every dropdown/notification-bell/count
  // consumer does) and this returns the plain array exactly as before -
  // changing the response shape for everyone would break those callers.
  async findAll(params: { status?: string; search?: string; viewerRole?: Role; page?: number; limit?: number }) {
    const hide = params.viewerRole ? HIDE_FINANCIALS_FOR.includes(params.viewerRole) : false;
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = {
      deliveryStatus: params.status ? (params.status as any) : undefined,
      OR: params.search
        ? [
            { orderId: { contains: params.search } },
            { customerName: { contains: params.search } },
            { phone: { contains: params.search } },
            { product: { contains: params.search } },
            { cotTrack: { contains: params.search } },
          ]
        : undefined,
    };
    const [orders, total] = await Promise.all([
      this.prisma.customerOrder.findMany({
        where,
        include: {
          payments: true,
          items: true,
          galleryImages: { include: { galleryImage: true } },
          createdBy: { select: { id: true, name: true } },
          assignedEmployee: { select: { id: true, name: true } },
          assignedBy: { select: { id: true, name: true } },
          modelNoUpdatedBy: { select: { id: true, name: true } },
        },
        orderBy: { orderDate: 'desc' },
        ...(paginated ? toSkipTake(page, limit) : {}),
      }),
      paginated ? this.prisma.customerOrder.count({ where }) : Promise.resolve(0),
    ]);
    const mapped = orders.map((o) => stripOrderMoney(withBalance(flattenGalleryImages(o)), hide));
    return paginated ? paginate(mapped, total, page, limit) : mapped;
  }

  async findOne(id: string, viewerRole?: Role) {
    const hide = viewerRole ? HIDE_FINANCIALS_FOR.includes(viewerRole) : false;
    const order = await this.prisma.customerOrder.findUnique({
      where: { id },
      include: {
        payments: { orderBy: { date: 'asc' } },
        items: true,
        galleryImages: { include: { galleryImage: true } },
        createdBy: { select: { id: true, name: true } },
        assignedEmployee: { select: { id: true, name: true } },
        assignedBy: { select: { id: true, name: true } },
        modelNoUpdatedBy: { select: { id: true, name: true } },
      },
    });
    if (!order) throw new NotFoundException('Customer order not found');
    return stripOrderMoney(withBalance(flattenGalleryImages(order)), hide);
  }

  async create(dto: CreateCustomerOrderDto, userId: string) {
    const existing = await this.prisma.customerOrder.findUnique({ where: { orderId: dto.orderId } });
    if (existing) throw new ConflictException('An order with this Order ID already exists');

    const jobNumber = await generateJobNumber(this.prisma);
    const { product, orderValue } = this.deriveFromItems(dto);

    const order = await this.prisma.customerOrder.create({
      data: {
        orderId: dto.orderId,
        jobNumber,
        orderDate: new Date(dto.orderDate),
        customerName: dto.customerName,
        phone: dto.phone,
        address: dto.address,
        product,
        size: dto.size,
        sizeUnit: dto.sizeUnit,
        orderValue,
        actualDeliveryDate: dto.actualDeliveryDate ? new Date(dto.actualDeliveryDate) : undefined,
        deliveryStatus: dto.deliveryStatus,
        createdById: userId,
        items: dto.items?.length
          ? {
              create: dto.items.map((i) => ({
                productId: i.productId,
                productName: i.productName,
                category: i.category,
                size: i.size,
                sizeUnit: i.sizeUnit,
                color: i.color,
                quantity: i.quantity ?? 1,
                unitPrice: i.unitPrice,
                referenceImageId: i.referenceImageId,
              })),
            }
          : undefined,
        galleryImages: dto.galleryImageIds?.length
          ? { create: dto.galleryImageIds.map((galleryImageId) => ({ galleryImageId })) }
          : undefined,
      },
      include: { payments: true, items: true },
    });

    await this.allocateItems(order.id, order.jobNumber ?? order.orderId, order.items, userId);

    await this.audit.log({
      userId,
      action: 'CUSTOMER_ORDER_CREATED',
      targetType: 'CustomerOrder',
      targetId: order.id,
      metadata: { orderId: order.orderId, jobNumber: order.jobNumber, customerName: order.customerName },
    });

    return this.findOne(order.id);
  }

  // Stock-first split (spec: check Godown Stock before creating
  // production) - runs once per line, after the order/items exist so the
  // resulting FinishedStockItem/CarpenterWorkItem rows can point back at
  // real ids. Only lines carrying a productId are stock-checked; a
  // brand-new custom product (no productId) always goes fully to
  // production.
  private async allocateItems(
    orderId: string,
    jobNumberForStock: string,
    items: { id: string; productId: string | null; productName: string; quantity: number; color?: string | null }[],
    userId: string,
  ) {
    for (const item of items) {
      const result = await this.stockAllocation.allocate({
        productId: item.productId ?? undefined,
        productName: item.productName,
        quantity: item.quantity,
        color: item.color ?? undefined,
        source: 'CUSTOMER_ORDER',
        sourceCustomerOrderId: orderId,
        sourceCustomerOrderItemId: item.id,
        jobNumberForStock,
        userId,
      });
      await this.prisma.customerOrderItem.update({
        where: { id: item.id },
        data: { stockReservedQty: result.stockReservedQty, productionQty: result.productionQty },
      });
    }
  }

  async update(id: string, dto: UpdateCustomerOrderDto, userId: string) {
    const current = await this.findOne(id);

    if (dto.orderId) {
      const existing = await this.prisma.customerOrder.findUnique({ where: { orderId: dto.orderId } });
      if (existing && existing.id !== id) throw new ConflictException('An order with this Order ID already exists');
    }

    // The Edit form always submits the full items[] array, even when the
    // user only changed something unrelated like Delivery Status - so
    // "items present in the payload" alone isn't a safe signal to release/
    // reallocate stock. Only do that expensive (and sometimes blocked-by-
    // dispatch) dance when the line contents actually changed.
    const usingItems = Boolean(dto.items?.length) && itemsDiffer(current.items ?? [], dto.items!);
    if (usingItems) {
      // Release whatever stock/production this order previously held
      // before replacing its lines - refuses (ConflictException) if any of
      // it is already dispatched or in progress, rather than silently
      // reallocating on top of work that's already started.
      await this.stockAllocation.release({ sourceCustomerOrderId: id, userId });
      await this.prisma.customerOrderItem.deleteMany({ where: { orderId: id } });
    }
    // Full replace, not merge - matches how items[] behaves. Explicitly
    // sending [] clears every attached image; omitting the field entirely
    // leaves the existing selection untouched.
    const replacingGallery = dto.galleryImageIds !== undefined;
    if (replacingGallery) {
      await this.prisma.customerOrderGalleryImage.deleteMany({ where: { orderId: id } });
    }
    const derived = this.deriveFromItemsOrPassthrough(dto);

    const order = await this.prisma.customerOrder.update({
      where: { id },
      data: {
        orderId: dto.orderId,
        orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
        customerName: dto.customerName,
        phone: dto.phone,
        address: dto.address,
        product: derived.product,
        size: dto.size,
        sizeUnit: dto.sizeUnit,
        orderValue: derived.orderValue,
        actualDeliveryDate: dto.actualDeliveryDate ? new Date(dto.actualDeliveryDate) : undefined,
        deliveryStatus: dto.deliveryStatus,
        items: usingItems
          ? {
              create: dto.items!.map((i) => ({
                productId: i.productId,
                productName: i.productName,
                category: i.category,
                size: i.size,
                sizeUnit: i.sizeUnit,
                color: i.color,
                quantity: i.quantity ?? 1,
                unitPrice: i.unitPrice,
              })),
            }
          : undefined,
        galleryImages: replacingGallery
          ? { create: dto.galleryImageIds!.map((galleryImageId) => ({ galleryImageId })) }
          : undefined,
      },
      include: { payments: true, items: true },
    });

    if (usingItems) {
      await this.allocateItems(order.id, order.jobNumber ?? order.orderId, order.items, userId);
      return this.findOne(order.id);
    }
    if (replacingGallery) return this.findOne(order.id);
    return withBalance(order);
  }

  // Same derivation as create(), but a plain-field edit (no items involved)
  // is allowed to touch just one of product/orderValue without requiring
  // both, unlike creation.
  private deriveFromItemsOrPassthrough(dto: { product?: string; orderValue?: number; items?: CustomerOrderItemDto[] }) {
    if (dto.items && dto.items.length > 0) {
      const product = dto.items.map((i) => i.productName).join(', ');
      const orderValue = dto.items.reduce((sum, i) => sum + i.unitPrice * (i.quantity ?? 1), 0);
      return { product, orderValue };
    }
    return { product: dto.product, orderValue: dto.orderValue };
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    // Release any reserved stock / undone production before deleting -
    // throws if any of it is already dispatched or in progress, blocking
    // the cancel rather than silently orphaning it.
    await this.stockAllocation.release({ sourceCustomerOrderId: id, userId });
    // Explicit child deletes, not a bare customerOrder.delete() relying on
    // the schema's onDelete: Cascade - confirmed live (via PartyOrder,
    // same gap) that no such FK constraint actually exists in MySQL, so
    // relying on it silently orphans payments/items, which then crashes
    // any full-table query that includes the (required) order relation -
    // such as the unified Payments ledger.
    await this.prisma.$transaction([
      this.prisma.customerOrderPayment.deleteMany({ where: { orderId: id } }),
      this.prisma.customerOrderItem.deleteMany({ where: { orderId: id } }),
      this.prisma.customerOrder.delete({ where: { id } }),
    ]);
    return { success: true };
  }

  async addPayment(orderId: string, dto: CreatePaymentDto, userId: string) {
    const existing = await this.findOne(orderId);
    const type = dto.type ?? suggestPaymentType(Number(existing.orderValue), existing.payments, dto.amount);
    await this.prisma.customerOrderPayment.create({
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
    const payment = await this.prisma.customerOrderPayment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.orderId !== orderId) throw new NotFoundException('Payment not found');
    await this.prisma.customerOrderPayment.delete({ where: { id: paymentId } });
    return this.findOne(orderId);
  }

  // Unified "Assign to Production": puts this order into production in one
  // step - creates the carpenter work item tagged with the order's Job
  // Number (so it's traceable via /search/track) and fires the WhatsApp
  // work-assignment notification, and (when employeeUserId is given) also
  // sets the order's assignedEmployeeId for Model No permission - what used
  // to be two separate calls (assignProduction + assignEmployee).
  async assignProduction(orderId: string, dto: AssignProductionDto, userId: string, viewerRole?: Role) {
    const order = await this.findOne(orderId);
    const quantity = dto.quantity ?? 1;
    const extra = dto.extra ?? 0;
    const price = dto.price ?? 0;
    const total = price * quantity + extra;

    if (dto.employeeUserId) {
      const employee = await this.prisma.user.findUnique({ where: { id: dto.employeeUserId } });
      if (!employee || (employee.role !== Role.CARPENTER && employee.role !== Role.CARVER && employee.role !== Role.POLISHER)) {
        throw new BadRequestException('Employee must be an active Carpenter, Carving or Polish team user');
      }
      await this.prisma.customerOrder.update({
        where: { id: orderId },
        data: { assignedEmployeeId: employee.id, assignedAt: new Date(), assignedById: userId },
      });
    }

    return this.carpenter.assignSourceProduction(
      { source: 'CUSTOMER_ORDER', sourceCustomerOrderId: orderId, assignedById: userId },
      {
        carpenterId: dto.carpenterId,
        stage: dto.stage as any,
        workDate: dto.workDate,
        modelNo: order.jobNumber ?? order.orderId,
        productName: order.product,
        category: dto.category,
        size: dto.size,
        sizeUnit: dto.sizeUnit,
        price,
        extra,
        quantity,
        total,
        notes: dto.notes,
        notifyWhatsapp: dto.notifyWhatsapp,
        color: dto.color,
      },
      userId,
      viewerRole,
    );
  }

  // Unified "Assign to Production" for one line of a multi-product Customer
  // Order - same shape as PartyOrdersService.assignItemProduction, scoped to
  // this line's own placeholder (sourceCustomerOrderItemId) so a multi-line
  // order can have each product assigned separately instead of the
  // order-level assignProduction() above grabbing whichever line's
  // placeholder happened to be created first.
  async assignItemProduction(orderId: string, itemId: string, dto: AssignProductionDto, userId: string, viewerRole?: Role) {
    const item = await this.prisma.customerOrderItem.findUnique({ where: { id: itemId } });
    if (!item || item.orderId !== orderId) throw new NotFoundException('Customer order line not found');
    const order = await this.findOne(orderId);

    if (dto.employeeUserId) {
      const employee = await this.prisma.user.findUnique({ where: { id: dto.employeeUserId } });
      if (!employee || (employee.role !== Role.CARPENTER && employee.role !== Role.CARVER && employee.role !== Role.POLISHER)) {
        throw new BadRequestException('Employee must be an active Carpenter, Carving or Polish team user');
      }
      await this.prisma.customerOrder.update({
        where: { id: orderId },
        data: { assignedEmployeeId: employee.id, assignedAt: new Date(), assignedById: userId },
      });
    }

    const quantity = dto.quantity ?? item.productionQty ?? 1;
    const extra = dto.extra ?? 0;
    const price = dto.price ?? 0;
    const total = price * quantity + extra;

    return this.carpenter.assignSourceProduction(
      { source: 'CUSTOMER_ORDER', sourceCustomerOrderId: orderId, sourceCustomerOrderItemId: itemId, assignedById: userId },
      {
        carpenterId: dto.carpenterId,
        stage: dto.stage as any,
        workDate: dto.workDate,
        modelNo: order.jobNumber ?? order.orderId,
        productName: item.productName,
        category: dto.category ?? item.category ?? undefined,
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
  }

  // Super Admin assigns the order to a production employee (Carpenter or
  // Polisher role user), who is then solely responsible for entering the
  // Model No. This is deliberately a User assignment (Users & Roles), not
  // the separate Carpenter-payee work-item assignment used by
  // assignProduction() above.
  async assignEmployee(id: string, dto: AssignEmployeeDto, assignedById: string) {
    await this.findOne(id);
    const employee = await this.prisma.user.findUnique({ where: { id: dto.employeeId } });
    if (!employee || (employee.role !== Role.CARPENTER && employee.role !== Role.CARVER && employee.role !== Role.POLISHER)) {
      throw new BadRequestException('Employee must be an active Carpenter, Carving or Polish team user');
    }

    await this.prisma.customerOrder.update({
      where: { id },
      data: { assignedEmployeeId: employee.id, assignedAt: new Date(), assignedById },
    });
    return this.findOne(id);
  }

  // Only the assigned production employee (or Superadmin) may set the
  // Model No - Super Admin never enters it directly on order create/edit.
  async updateModelNo(id: string, dto: UpdateModelNoDto, user: AuthUser) {
    const order = await this.findOne(id);
    if (user.role !== Role.SUPERADMIN && order.assignedEmployeeId !== user.userId) {
      throw new ForbiddenException('This order is not assigned to you');
    }

    const modelNo = dto.modelNo.trim();
    if (!modelNo) throw new BadRequestException('Model No cannot be empty');

    const previousModelNo = order.cotTrack;
    const updated = await this.prisma.customerOrder.update({
      where: { id },
      data: { cotTrack: modelNo, modelNoUpdatedById: user.userId, modelNoUpdatedAt: new Date() },
    });

    const employee = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { name: true } });
    await this.audit.log({
      userId: user.userId,
      action: 'MODEL_NO_UPDATED',
      targetType: 'CustomerOrder',
      targetId: id,
      metadata: {
        orderType: 'CUSTOMER_ORDER',
        orderId: order.orderId,
        customerName: order.customerName,
        previousModelNo,
        modelNo,
        employeeName: employee?.name,
      },
    });

    return this.findOne(updated.id, user.role as Role);
  }

  // Matches the shop's own printed "BILL & PAYMENT / ORDER CONFIRMATION"
  // template - the branded banner is the same image already attached to
  // every WhatsApp order-confirmation message; everything below it (item
  // boxes, payment summary, grand total) is generated from the real order
  // data instead of copied text.
  private buildPdfHtml(order: Awaited<ReturnType<CustomerOrdersService['findOne']>>, recipientType: 'customer' | 'employee' = 'customer'): string {
    const isEmployee = recipientType === 'employee';
    const lines: { label: string; qty: number; unitPrice: number; total: number; details: string[] }[] = order.items.length
      ? order.items.map((i) => ({
          label: i.category || i.productName,
          qty: i.quantity,
          unitPrice: Number(i.unitPrice),
          total: i.quantity * Number(i.unitPrice),
          details: [
            `Product : ${i.productName}`,
            i.size ? `Size : ${i.size}${i.sizeUnit ? ` ${i.sizeUnit}` : ''}` : null,
            i.color ? `Colour : ${i.color}` : null,
            `Quantity : ${i.quantity}`,
            isEmployee ? null : `Price : ₹${Number(i.unitPrice).toLocaleString('en-IN')}/-`,
          ].filter((d): d is string => d !== null),
        }))
      : [
          {
            label: order.product,
            qty: 1,
            unitPrice: Number(order.orderValue),
            total: Number(order.orderValue),
            details: [`Product : ${order.product}`, isEmployee ? null : `Price : ₹${Number(order.orderValue).toLocaleString('en-IN')}/-`].filter(
              (d): d is string => d !== null,
            ),
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
  .title-row { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 6px; }
  .title h1 { margin: 0; font-size: 26px; letter-spacing: 0.5px; }
  .title h1 .accent { color: #80011f; }
  .title p { margin: 2px 0 0; font-size: 12px; letter-spacing: 3px; color: #80011f; font-weight: bold; }
  .meta-box { border: 1px solid #c9a227; border-radius: 6px; padding: 10px 16px; font-size: 12px; text-align: left; min-width: 220px; }
  .meta-box div { margin: 2px 0; }
  .meta-box b { display: inline-block; width: 100px; }
  .greeting { margin: 18px 0 4px; font-size: 14px; }
  .greeting .name { font-weight: bold; }
  /* Chromium's print engine (Puppeteer) will otherwise slice a box right
     across a page boundary, cutting its border/background mid-item - both
     break-inside (standard) and page-break-inside (older WebKit alias, kept
     for safety) are needed to actually stop that. */
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
    <div class="title-row" style="break-inside: avoid; page-break-inside: avoid;">
      <div class="title">
        ${isEmployee ? `<h1>ORDER <span class="accent">DETAILS</span></h1>` : `<h1>BILL <span class="accent">&amp; PAYMENT</span></h1>`}
        <p>ORDER CONFIRMATION</p>
      </div>
      <div class="meta-box">
        <div><b>Invoice No</b> : ${escapeHtml(order.jobNumber ?? order.orderId)}</div>
        <div><b>Date</b> : ${order.orderDate.toLocaleDateString('en-IN')}</div>
        ${isEmployee ? '' : `<div><b>Payment Mode</b> : ${escapeHtml(paymentMode)}</div>`}
      </div>
    </div>

    <p class="greeting">Dear <span class="name">${escapeHtml(isEmployee ? (order.assignedEmployee?.name ?? 'Team') : order.customerName)}</span>,<br/>${
      isEmployee ? 'Please proceed with the following order:' : 'Kindly check and confirm the following order details:'
    }</p>

    ${itemBoxes}

    ${
      isEmployee
        ? ''
        : `<div class="summary-section">
      <div class="summary-title">PAYMENT SUMMARY</div>
      <table class="summary">
        <thead><tr><th style="width:40px">S.No</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>
          ${summaryRows}
          <tr class="grand-total"><td colspan="2" style="text-align:right">GRAND TOTAL</td><td style="text-align:right">₹${Number(order.orderValue).toLocaleString('en-IN')}/-</td></tr>
          <tr><td colspan="2" style="text-align:right">Amount Received</td><td style="text-align:right">₹${Number(order.totalReceived).toLocaleString('en-IN')}/-</td></tr>
          <tr class="grand-total"><td colspan="2" style="text-align:right">BALANCE DUE</td><td style="text-align:right">₹${Number(order.balanceAmount).toLocaleString('en-IN')}/-</td></tr>
        </tbody>
      </table>
    </div>`
    }

    <p class="thanks"><strong>Thank you</strong> for your trust and support - SSS Furniture</p>
  </div>
</body></html>`;
  }

  async generatePdf(id: string, recipientType: 'customer' | 'employee' = 'customer'): Promise<Buffer> {
    const order = await this.findOne(id);
    return this.pdf.renderHtmlToPdf(this.buildPdfHtml(order, recipientType));
  }

  async sendPdfToCustomer(id: string) {
    const order = await this.findOne(id);
    if (!order.phone) {
      return { sent: false, reason: 'no_customer_phone' as const };
    }
    const buffer = await this.generatePdf(id);
    return this.whatsapp.sendDocument(order.phone, {
      buffer,
      filename: `Order Confirmation - ${order.orderId}.pdf`,
      mimetype: 'application/pdf',
      caption: `Order confirmation ${order.orderId} - ${order.product} - SSS Company`,
    });
  }
}
