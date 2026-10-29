import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { buildQuotationHtml, readSpecs, type QuotationLine } from '../../../common/utils/quotation-pdf.util';
import { cleanSpecs, specsKey } from './dto/item-specs.dto';
import { AuditService } from '../../audit/audit.service';
import { CarpenterService } from '../../carpenter/carpenter.service';
import { StockAllocationService } from '../../inventory/products/stock-allocation.service';
import { PdfService } from '../../pdf/pdf.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { CreateCustomerOrderDto, CustomerOrderItemDto } from './dto/create-customer-order.dto';
import { UpdateCustomerOrderDto } from './dto/update-customer-order.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { ModelNoService } from '../../model-no/model-no.service';
import { AssignProductionDto } from './dto/assign-production.dto';
import { AssignEmployeeDto } from './dto/assign-employee.dto';
import { UpdateModelNoDto } from './dto/update-model-no.dto';
import { UpdateModelNoDateDto } from './dto/update-model-no-date.dto';
import { computeBalance, suggestPaymentType } from '../../../common/utils/balance.util';
import { generateJobNumber } from '../../../common/utils/job-number.util';
import { paginate, toSkipTake } from '../../../common/utils/pagination.util';
import { Role } from '../../../common/enums/role.enum';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

const HIDE_FINANCIALS_FOR: Role[] = [Role.CARPENTER, Role.POLISHER];


// Order-insensitive comparison of the saved lines against a submitted
// items[] payload - the Edit form always sends the full array (even lines
// nobody touched), so "items present" alone can't tell us whether anything
// actually changed. Only a genuine difference should trigger the release/
// reallocate cycle.
// One order line's identity for "did the lines change?" - everything
// except the quotation specs, so editing only specs never re-creates lines
// (which would release and re-allocate stock/production).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function itemLineKey(i: any): string {
  return `${i.productId ?? ''}|${i.productName}|${i.category ?? ''}|${i.size ?? ''}|${i.sizeUnit ?? ''}|${i.color ?? ''}|${i.quantity ?? 1}|${Number(i.unitPrice)}|${i.referenceImageId ?? ''}`;
}

function itemsDiffer(
  current: {
    productId?: string | null;
    productName: string;
    category?: string | null;
    size?: string | null;
    sizeUnit?: string | null;
    color?: string | null;
    quantity: number;
    unitPrice: number | string;
    referenceImageId?: string | null;
  }[],
  incoming: CustomerOrderItemDto[],
): boolean {
  const serialize = (
    items: {
      productId?: string | null;
      productName: string;
      category?: string | null;
      size?: string | null;
      sizeUnit?: string | null;
      color?: string | null;
      quantity?: number;
      unitPrice: number | string;
      referenceImageId?: string | null;
    }[],
  ) =>
    items
      .map(itemLineKey)
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
    private modelNos: ModelNoService,
  ) {}

  // The item-level Model No field (ModelNoPicker on the frontend) is a
  // search-and-autofill box: picking an existing match already sets
  // productId directly, so there's nothing to do here for those lines. A
  // typed Model No with NO match is treated as a brand-new catalogue
  // product - Admin/Super Admin (the only roles that can reach create/
  // update at all, see the controller) can register it right from the
  // order form instead of it being silently discarded. `upsert` on the
  // unique modelNo makes this race-safe: two lines (or two concurrent
  // saves) with the same new Model No land on the same Product row instead
  // of erroring or duplicating. An existing Product's catalogue data is
  // never overwritten by an order line's snapshot values (`update: {}`).
  private async resolveItemModelNos<T extends CustomerOrderItemDto>(
    items: T[],
    userId: string,
  ): Promise<(T & { modelNoSetById?: string; modelNoSetAt?: Date })[]> {
    const pending = items.filter((i) => !i.productId && i.modelNo?.trim());
    const resolved = new Map<string, string>();
    for (const i of pending) {
      // A Model No is a number: "PO-NEW-2" is registered as 2, and an
      // existing product with that number is reused - never duplicated.
      const modelNo = this.modelNos.requireClean(i.modelNo);
      if (resolved.has(modelNo)) continue;
      const { product } = await this.modelNos.ensureCatalogProduct({
        modelNo,
        name: i.productName,
        category: i.category,
        modelSize: i.size,
        sizeUnit: i.sizeUnit,
        materialFinish: i.color,
        retailPrice: i.unitPrice,
        unit: 'Nos',
      });
      resolved.set(modelNo, product.id);
    }

    return items.map((i) => {
      const modelNo = this.modelNos.lenient(i.modelNo);
      const productId = !i.productId && modelNo && resolved.has(modelNo) ? resolved.get(modelNo) : i.productId;
      // Stamp who/when this line's Model No was set whenever one is
      // present on this save - same "by X - date" the list shows next to
      // it, per product line.
      return { ...i, productId, ...(modelNo ? { modelNoSetById: userId, modelNoSetAt: new Date() } : {}) };
    });
  }

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
          items: { include: { referenceImage: true, product: { select: { modelNo: true } }, modelNoSetBy: { select: { id: true, name: true, role: true } } } },
          galleryImages: { include: { galleryImage: true } },
          createdBy: { select: { id: true, name: true } },
          assignedEmployee: { select: { id: true, name: true } },
          assignedBy: { select: { id: true, name: true } },
          modelNoUpdatedBy: { select: { id: true, name: true, role: true } },
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
        items: { include: { referenceImage: true, product: { select: { modelNo: true } }, modelNoSetBy: { select: { id: true, name: true, role: true } } } },
        galleryImages: { include: { galleryImage: true } },
        createdBy: { select: { id: true, name: true } },
        assignedEmployee: { select: { id: true, name: true } },
        assignedBy: { select: { id: true, name: true } },
        modelNoUpdatedBy: { select: { id: true, name: true, role: true } },
      },
    });
    if (!order) throw new NotFoundException('Customer order not found');
    return stripOrderMoney(withBalance(flattenGalleryImages(order)), hide);
  }

  async create(dto: CreateCustomerOrderDto, userId: string) {
    const existing = await this.prisma.customerOrder.findUnique({ where: { orderId: dto.orderId } });
    if (existing) throw new ConflictException('An order with this Order ID already exists');

    const jobNumber = await generateJobNumber(this.prisma);
    const resolvedItems = dto.items?.length ? await this.resolveItemModelNos(dto.items, userId) : undefined;
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
        cotTrack: dto.cotTrack?.trim() || undefined,
        modelNoUpdatedById: dto.cotTrack?.trim() ? userId : undefined,
        modelNoUpdatedAt: dto.cotTrack?.trim() ? new Date() : undefined,
        createdById: userId,
        items: resolvedItems?.length
          ? {
              create: resolvedItems.map((i) => ({
                productId: i.productId,
                productName: i.productName,
                category: i.category,
                size: i.size,
                sizeUnit: i.sizeUnit,
                color: i.color,
                quantity: i.quantity ?? 1,
                unitPrice: i.unitPrice,
                modelNoSetById: i.modelNoSetById,
                modelNoSetAt: i.modelNoSetAt,
                referenceImageId: i.referenceImageId,
                specs: cleanSpecs(i.specs) ?? Prisma.JsonNull,
              })),
            }
          : undefined,
        galleryImages: dto.galleryImageIds?.length
          ? { create: dto.galleryImageIds.map((galleryImageId) => ({ galleryImageId })) }
          : undefined,
      },
      include: { payments: true, items: { include: { referenceImage: true, product: { select: { modelNo: true } }, modelNoSetBy: { select: { id: true, name: true, role: true } } } } },
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

  // Spec-only edits: lines unchanged, so update each line's specs in place
  // (matched by line content). A line sent without a specs field is left
  // as it is. Returns true when anything changed.
  private async syncItemSpecs(current: { id: string; specs?: unknown }[], incoming: CustomerOrderItemDto[]): Promise<boolean> {
    const pool = new Map<string, { id: string; specs?: unknown }[]>();
    for (const c of current) pool.set(itemLineKey(c), [...(pool.get(itemLineKey(c)) ?? []), c]);
    let changed = false;
    for (const i of incoming) {
      if (i.specs === undefined) continue;
      const c = pool.get(itemLineKey(i))?.shift();
      if (!c || specsKey(c.specs) === specsKey(i.specs)) continue;
      await this.prisma.customerOrderItem.update({ where: { id: c.id }, data: { specs: cleanSpecs(i.specs) ?? Prisma.JsonNull } });
      changed = true;
    }
    return changed;
  }

  async update(id: string, dto: UpdateCustomerOrderDto, userId: string, force = false, viewerRole?: Role) {
    const current = await this.findOne(id);

    if (dto.orderId) {
      const existing = await this.prisma.customerOrder.findUnique({ where: { orderId: dto.orderId } });
      if (existing && existing.id !== id) throw new ConflictException('An order with this Order ID already exists');
    }

    // force is only ever honored for SUPERADMIN - Admin still gets the
    // normal safety block even if a stale/tampered request sends force=true.
    const effectiveForce = force && viewerRole === Role.SUPERADMIN;
    if (force && !effectiveForce) {
      throw new ForbiddenException('Only Super Admin can force this change through');
    }

    // The Edit form always submits the full items[] array, even when the
    // user only changed something unrelated like Delivery Status - so
    // "items present in the payload" alone isn't a safe signal to release/
    // reallocate stock. Only do that expensive (and sometimes blocked-by-
    // dispatch) dance when the line contents actually changed.
    const usingItems = Boolean(dto.items?.length) && itemsDiffer(current.items ?? [], dto.items!);
    const resolvedItems = dto.items?.length ? await this.resolveItemModelNos(dto.items, userId) : undefined;
    if (usingItems) {
      // Release whatever stock/production this order previously held
      // before replacing its lines - refuses (ConflictException) if any of
      // it is already dispatched or in progress, rather than silently
      // reallocating on top of work that's already started. effectiveForce
      // (SUPERADMIN only, see above) skips the "already in progress" block
      // but never the dispatched one - see StockAllocationService.release.
      await this.stockAllocation.release({ sourceCustomerOrderId: id, userId, force: effectiveForce });
      if (effectiveForce) {
        await this.audit.log({
          userId,
          action: 'FORCE_EDIT_CUSTOMER_ORDER_ITEMS',
          targetType: 'CustomerOrder',
          targetId: id,
          metadata: { orderId: current.orderId },
        });
      }
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
        cotTrack: dto.cotTrack?.trim() || undefined,
        modelNoUpdatedById: dto.cotTrack?.trim() ? userId : undefined,
        modelNoUpdatedAt: dto.cotTrack?.trim() ? new Date() : undefined,
        items: usingItems
          ? {
              create: resolvedItems!.map((i) => ({
                productId: i.productId,
                productName: i.productName,
                category: i.category,
                size: i.size,
                sizeUnit: i.sizeUnit,
                color: i.color,
                quantity: i.quantity ?? 1,
                unitPrice: i.unitPrice,
                modelNoSetById: i.modelNoSetById,
                modelNoSetAt: i.modelNoSetAt,
                referenceImageId: i.referenceImageId,
                specs: cleanSpecs(i.specs) ?? Prisma.JsonNull,
              })),
            }
          : undefined,
        galleryImages: replacingGallery
          ? { create: dto.galleryImageIds!.map((galleryImageId) => ({ galleryImageId })) }
          : undefined,
      },
      include: { payments: true, items: { include: { referenceImage: true, product: { select: { modelNo: true } }, modelNoSetBy: { select: { id: true, name: true, role: true } } } } },
    });

    if (usingItems) {
      await this.allocateItems(order.id, order.jobNumber ?? order.orderId, order.items, userId);
      return this.findOne(order.id);
    }
    if (dto.items?.length && !usingItems && (await this.syncItemSpecs(current.items ?? [], dto.items))) return this.findOne(order.id);
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

  async remove(id: string, userId: string, force = false, viewerRole?: Role) {
    const order = await this.findOne(id);
    const effectiveForce = force && viewerRole === Role.SUPERADMIN;
    if (force && !effectiveForce) {
      throw new ForbiddenException('Only Super Admin can force this delete through');
    }
    // Release any reserved stock / undone production before deleting -
    // throws if any of it is already dispatched or in progress, blocking
    // the cancel rather than silently orphaning it. effectiveForce
    // (SUPERADMIN only) skips the "already in progress" block, never the
    // dispatched one - see StockAllocationService.release.
    await this.stockAllocation.release({ sourceCustomerOrderId: id, userId, force: effectiveForce });
    if (effectiveForce) {
      await this.audit.log({
        userId,
        action: 'FORCE_DELETE_CUSTOMER_ORDER',
        targetType: 'CustomerOrder',
        targetId: id,
        metadata: { orderId: order.orderId },
      });
    }
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
    await this.autoMarkDeliveredIfPaid(orderId);
    return this.findOne(orderId);
  }

  // Clearing the balance is treated as an implicit "delivered" signal,
  // matching how the physical tracking sheet worked (balance cleared =
  // picked up/delivered). Only advances PENDING/OUT_FOR_DELIVERY forward -
  // a CANCELLED or already-failed delivery is left alone, since a late
  // payment on a cancelled order doesn't mean it was actually delivered.
  private async autoMarkDeliveredIfPaid(orderId: string) {
    const order = await this.prisma.customerOrder.findUnique({
      where: { id: orderId },
      include: { payments: true },
    });
    if (!order) return;
    const { balanceAmount } = computeBalance(Number(order.orderValue), order.payments);
    if (balanceAmount <= 0 && (order.deliveryStatus === 'PENDING' || order.deliveryStatus === 'OUT_FOR_DELIVERY')) {
      await this.prisma.customerOrder.update({ where: { id: orderId }, data: { deliveryStatus: 'DELIVERED' } });
    }
  }

  // Corrects a recorded payment in place (previously the only fix was
  // delete + re-add). Re-runs the "fully paid -> delivered" check, and logs
  // the old and new values.
  async updatePayment(orderId: string, paymentId: string, dto: UpdatePaymentDto, userId: string) {
    const payment = await this.prisma.customerOrderPayment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.orderId !== orderId) throw new NotFoundException('Payment not found');
    const updated = await this.prisma.customerOrderPayment.update({
      where: { id: paymentId },
      data: { date: dto.date ? new Date(dto.date) : undefined, amount: dto.amount, type: dto.type, mode: dto.mode, note: dto.note },
    });
    await this.autoMarkDeliveredIfPaid(orderId);
    await this.audit.log({
      userId,
      action: 'CUSTOMER_ORDER_PAYMENT_UPDATED',
      targetType: 'CustomerOrderPayment',
      targetId: paymentId,
      metadata: {
        orderId,
        before: { date: payment.date, amount: Number(payment.amount), type: payment.type, mode: payment.mode, note: payment.note },
        after: { date: updated.date, amount: Number(updated.amount), type: updated.type, mode: updated.mode, note: updated.note },
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

    const modelNo = this.modelNos.requireCleanList(dto.modelNo);

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

  // SUPERADMIN-only correction of when the Model No was recorded as entered
  // - separate from updateModelNo() above, which is the normal
  // employee-entry flow and always stamps "now". This exists purely to fix
  // a wrong/late timestamp after the fact (e.g. entered late, or backfilled
  // from a paper record) - it never touches the Model No value itself or
  // who entered it.
  async updateModelNoDate(id: string, dto: UpdateModelNoDateDto, user: AuthUser) {
    const order = await this.findOne(id);
    if (!order.modelNoUpdatedAt) {
      throw new BadRequestException('This order has no Model No entry date to correct yet.');
    }

    const previousDate = order.modelNoUpdatedAt;
    const updated = await this.prisma.customerOrder.update({
      where: { id },
      data: { modelNoUpdatedAt: new Date(dto.modelNoUpdatedAt) },
    });

    await this.audit.log({
      userId: user.userId,
      action: 'MODEL_NO_DATE_CORRECTED',
      targetType: 'CustomerOrder',
      targetId: id,
      metadata: {
        orderId: order.orderId,
        customerName: order.customerName,
        previousDate,
        newDate: updated.modelNoUpdatedAt,
      },
    });

    return this.findOne(updated.id, user.role as Role);
  }

  // Matches the shop's own printed "BILL & PAYMENT / ORDER CONFIRMATION"
  // template - the branded banner is the same image already attached to
  // every WhatsApp order-confirmation message; everything below it (item
  // boxes, payment summary, grand total) is generated from the real order
  // data instead of copied text.
  // Order PDF (download / WhatsApp) in the SSS Quotation layout - one block
  // per line with its spec boxes and price. The employee copy leaves out
  // prices and payments.
  async generatePdf(id: string, recipientType: 'customer' | 'employee' = 'customer'): Promise<Buffer> {
    const order = await this.findOne(id);
    const isEmployee = recipientType === 'employee';
    const lines: QuotationLine[] = order.items.length
      ? order.items.map((i) => ({
          productName: i.productName,
          modelNo: (i as any).modelNo?.trim() || i.product?.modelNo?.trim() || (order.items.length === 1 ? order.cotTrack?.trim() : null) || null,
          category: i.category,
          size: [i.size, i.sizeUnit].filter(Boolean).join(' ') || null,
          color: i.color,
          qty: i.quantity,
          unitPrice: Number(i.unitPrice),
          specs: readSpecs(i.specs),
        }))
      : [
          {
            productName: order.product,
            modelNo: order.cotTrack?.trim() || null,
            size: [order.size, order.sizeUnit].filter(Boolean).join(' ') || null,
            color: order.colour,
            details: order.specialInstructions,
            qty: 1,
            unitPrice: Number(order.orderValue),
          },
        ];
    const html = buildQuotationHtml({
      title: isEmployee ? 'Order Details' : 'Quotation',
      docNo: order.jobNumber ?? order.orderId,
      date: order.orderDate,
      partyLabel: isEmployee ? 'For' : 'Customer',
      partyName: isEmployee ? (order.assignedEmployee?.name ?? 'Team') : order.customerName,
      phone: isEmployee ? null : order.phone,
      lines,
      showPrices: !isEmployee,
      received: isEmployee ? 0 : Number(order.totalReceived ?? 0),
    });
    return this.pdf.renderHtmlToPdf(html);
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
      caption: `Order confirmation ${order.orderId} - ${order.product} - SSS Furniture`,
    });
  }
}
