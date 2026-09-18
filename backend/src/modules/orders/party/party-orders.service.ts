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

// A shop's aggregated numbers, computed from whatever order array is handed
// in - used identically for one group's card on the shop list, and for both
// the "overall" and "filtered" summaries on the shop dashboard, so the same
// rules (which statuses count as pending/delivered, how balance is summed)
// can never drift between the two views.
function summarizeShopOrders(
  shop: { id: string | null; name: string; contactPerson?: string | null; contactPhone?: string | null; whatsapp?: string | null; address?: string | null; isActive?: boolean },
  orders: { totalAmount: any; receivedAmount: number; deliveryStatus: string; orderDate: Date }[],
) {
  const orderCount = orders.length;
  const totalValue = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
  const totalPaid = orders.reduce((sum, o) => sum + Number(o.receivedAmount), 0);
  const balanceDue = Math.round((totalValue - totalPaid) * 100) / 100;
  const pendingCount = orders.filter((o) => o.deliveryStatus === 'PENDING').length;
  const deliveredCount = orders.filter((o) => o.deliveryStatus === 'DELIVERED').length;
  const lastOrderDate = orders.reduce<Date | null>((max, o) => (!max || o.orderDate > max ? o.orderDate : max), null);
  return {
    shopId: shop.id,
    shopName: shop.name,
    contactPerson: shop.contactPerson ?? null,
    contactPhone: shop.contactPhone ?? null,
    whatsapp: shop.whatsapp ?? null,
    address: shop.address ?? null,
    isActive: shop.isActive ?? true,
    orderCount,
    totalValue,
    totalPaid,
    balanceDue,
    pendingCount,
    deliveredCount,
    lastOrderDate,
  };
}

type ShopSummary = ReturnType<typeof summarizeShopOrders>;

// Same money-hiding rule as stripOrderMoney, applied to an aggregated
// summary instead of one order - a worker role must never see shop-level
// totals either, only the non-monetary counts.
function stripShopSummaryMoney(summary: ShopSummary, hide: boolean): ShopSummary {
  if (!hide) return summary;
  const { totalValue, totalPaid, balanceDue, ...rest } = summary;
  return rest as ShopSummary;
}

// One row per PartyOrderItem line, across every order in the given
// (already-filtered) array - the "Product Supply Details" table on the Shop
// Dashboard and its PDF/Excel exports. Legacy orders that predate the
// items[] table (items.length === 0) fall back to the order's own
// model/size/finish/price/qty fields, same fallback productSummary()/
// modelNoSummary() already use on the shop-list card.
function buildSupplyRows(
  orders: any[],
  hide: boolean,
): {
  orderId: string;
  date: Date;
  order: string;
  finish: string | null;
  size: string | null;
  pattern: string | null;
  modelNo: string | null;
  price?: number;
  qty: number;
  value?: number;
}[] {
  return orders.flatMap((o) => {
    if (o.items?.length) {
      return o.items.map((it: any) => ({
        orderId: o.id,
        date: o.orderDate,
        order: it.productName,
        finish: it.finish ?? null,
        size: [it.size, it.sizeUnit].filter(Boolean).join(' ') || null,
        pattern: it.pattern ?? null,
        modelNo: it.modelNo ?? null,
        ...(hide ? {} : { price: Number(it.unitPrice ?? 0), value: Number(it.totalValue ?? 0) }),
        qty: it.qty ?? 1,
      }));
    }
    return [
      {
        orderId: o.id,
        date: o.orderDate,
        order: o.model ?? o.shopName,
        finish: o.finish ?? null,
        size: [o.size, o.sizeUnit].filter(Boolean).join(' ') || null,
        pattern: null,
        modelNo: o.cotNo ?? null,
        ...(hide ? {} : { price: o.price != null ? Number(o.price) : undefined, value: Number(o.totalAmount ?? 0) }),
        qty: o.qty ?? 1,
      },
    ];
  });
}

// The Payment Ledger's running balance - every payment across the given
// (already-filtered) orders, oldest first, each row showing the shop's
// running balance after that payment (totalOrderValue minus every payment
// up to and including this one). Never shown to HIDE_FINANCIALS_FOR roles -
// same rule as every other money field on this dashboard.
function buildPaymentLedger(orders: any[], totalOrderValue: number, hide: boolean) {
  if (hide) return [];
  const rows = orders.flatMap((o) =>
    (o.payments ?? []).map((p: any) => ({
      date: p.date as Date,
      createdAt: p.createdAt as Date,
      voucherNo: (p.note as string | null) ?? null,
      orderValue: Number(o.totalAmount ?? 0),
      amount: Number(p.amount ?? 0),
      mode: (p.mode as string | null) ?? null,
    })),
  );
  rows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime());
  let runningPaid = 0;
  return rows.map(({ createdAt: _createdAt, ...row }) => {
    runningPaid += row.amount;
    return { ...row, balance: Math.round((totalOrderValue - runningPaid) * 100) / 100 };
  });
}

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

  // The single filtered dataset every list/summary/PDF/Excel view is built
  // from - full order objects (real numbers, not money-stripped) after the
  // same where-clause + derived paymentStatus filter, before any
  // pagination or role-based stripping. findAll(), getShopSummaries(),
  // getShopDashboard(), generateListPdf() and generateListCsv() all call
  // this and only this, so none of them can ever disagree about which rows
  // match a given filter set.
  private async getFilteredOrders(params: {
    status?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    shopId?: string;
    paymentStatus?: 'SETTLED' | 'DUE';
  }) {
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
            { jobNumber: { contains: params.search } },
            { items: { some: { productName: { contains: params.search } } } },
            { items: { some: { modelNo: { contains: params.search } } } },
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
    return params.paymentStatus ? withStatus.filter((o) => o.paymentStatus === params.paymentStatus) : withStatus;
  }

  // Opt-in pagination - see the identical note on CustomerOrdersService.findAll.
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
    const filtered = await this.getFilteredOrders(params);
    const mapped = filtered.map((o) => stripOrderMoney(o, hide));

    if (!paginated) return mapped;
    const { skip, take } = toSkipTake(page, limit);
    return paginate(mapped.slice(skip, skip + take), mapped.length, page, limit);
  }

  // Powers the shop-centric main page: one card per shop, grouped from the
  // same filtered order array findAll() uses - so "Shop = X, Date = Y" on
  // this view and on the old flat list can never show different orders.
  // Legacy rows with no shopId (pre-Shop-directory) group by shopName
  // instead, so they still surface as a card rather than being dropped.
  async getShopSummaries(params: {
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
    const filtered = await this.getFilteredOrders(params);

    const groups = new Map<string, { shopId: string | null; shopName: string; orders: typeof filtered }>();
    for (const o of filtered) {
      const key = o.shopId ?? `name:${o.shopName}`;
      const group = groups.get(key);
      if (group) group.orders.push(o);
      else groups.set(key, { shopId: o.shopId, shopName: o.shopName, orders: [o] });
    }

    const shopIds = [...groups.values()].map((g) => g.shopId).filter((id): id is string => !!id);
    const shops = shopIds.length ? await this.prisma.shop.findMany({ where: { id: { in: shopIds } } }) : [];
    const shopById = new Map(shops.map((s) => [s.id, s]));

    const summaries = [...groups.values()]
      .map((g) => summarizeShopOrders(g.shopId ? (shopById.get(g.shopId) ?? { id: g.shopId, name: g.shopName }) : { id: null, name: g.shopName }, g.orders))
      .sort((a, b) => a.shopName.localeCompare(b.shopName))
      .map((s) => stripShopSummaryMoney(s, hide));

    const paginated = params.page != null;
    if (!paginated) return summaries;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const { skip, take } = toSkipTake(page, limit);
    return paginate(summaries.slice(skip, skip + take), summaries.length, page, limit);
  }

  // Powers the Shop Dashboard: the shop's own record, an "Overall" summary
  // (all of this shop's orders, no other filters), a "Filtered" summary
  // (this shop + whatever date/status/payment filters are active), and the
  // matching paginated order list - all from the same getFilteredOrders().
  async getShopDashboard(
    shopId: string,
    params: {
      status?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
      paymentStatus?: 'SETTLED' | 'DUE';
      viewerRole?: Role;
      page?: number;
      limit?: number;
    },
  ) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Shop not found');

    const hide = params.viewerRole ? HIDE_FINANCIALS_FOR.includes(params.viewerRole) : false;

    const overallOrders = await this.getFilteredOrders({ shopId });
    const filteredOrders = await this.getFilteredOrders({ ...params, shopId });

    const overallSummary = stripShopSummaryMoney(summarizeShopOrders(shop, overallOrders), hide);
    const filteredSummary = stripShopSummaryMoney(summarizeShopOrders(shop, filteredOrders), hide);

    // Product Supply Details + Payment Ledger - built from the complete
    // filtered set (not the paginated page below), so they always agree
    // with filteredSummary's totals no matter which order page is showing.
    const items = buildSupplyRows(filteredOrders, hide);
    const paymentLedger = buildPaymentLedger(filteredOrders, filteredSummary.totalValue ?? 0, hide);

    const mapped = filteredOrders.map((o) => stripOrderMoney(o, hide));
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const { skip, take } = toSkipTake(page, limit);
    const orders = paginate(mapped.slice(skip, skip + take), mapped.length, page, limit);

    return { shop, overallSummary, filteredSummary, orders, items, paymentLedger };
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
          ${isEmployee ? '' : `<td style="text-align:right">${l.price != null ? `Rs. ${l.price.toLocaleString('en-IN')}` : '-'}</td>`}
          <td>${escapeHtml(l.modelNo)}</td>
          ${isEmployee ? '' : `<td style="text-align:right">Rs. ${l.value.toLocaleString('en-IN')}</td>`}
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
      <div><div class="label">Total Order Value</div><div class="value">Rs. ${totalOrderValue.toLocaleString('en-IN')}</div></div>
      <div><div class="label">Received</div><div class="value" style="color:#15803d">Rs. ${received.toLocaleString('en-IN')}</div></div>
      <div><div class="label">Balance</div><div class="value" style="color:#b91c1c">Rs. ${balance.toLocaleString('en-IN')}</div></div>
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
  // showing, never the whole table. Uses the same getFilteredOrders() as
  // the list/summary endpoints so this can never diverge from what's on
  // screen. viewerRole strips financials the same way findAll() does -
  // this route was previously reachable by any authenticated role without
  // ever hiding totals, unlike every other party-order endpoint.
  async generateListPdf(params: {
    status?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    shopId?: string;
    paymentStatus?: 'SETTLED' | 'DUE';
    viewerRole?: Role;
  }): Promise<Buffer> {
    const hide = params.viewerRole ? HIDE_FINANCIALS_FOR.includes(params.viewerRole) : false;
    const filtered = await this.getFilteredOrders(params);
    const orders = filtered.map((o) => stripOrderMoney(o, hide));
    const rows = orders
      .map(
        (o: any, idx) => `<tr>
          <td>${idx + 1}</td>
          <td>${escapeHtml(o.jobNumber ?? o.cotNo ?? o.id)}</td>
          <td>${escapeHtml(o.shopName)}</td>
          <td>${new Date(o.orderDate).toLocaleDateString('en-IN')}</td>
          <td>${o.items?.length ?? 0}</td>
          ${
            hide
              ? ''
              : `<td style="text-align:right">Rs. ${Number(o.totalAmount ?? 0).toLocaleString('en-IN')}</td>
          <td style="text-align:right">Rs. ${Number(o.receivedAmount ?? 0).toLocaleString('en-IN')}</td>
          <td style="text-align:right">Rs. ${Number(o.balanceAmount ?? 0).toLocaleString('en-IN')}</td>`
          }
          <td>${escapeHtml(String(o.deliveryStatus).replace(/_/g, ' '))}</td>
        </tr>`,
      )
      .join('');

    let shopName: string | undefined;
    if (params.shopId) {
      const shop = await this.prisma.shop.findUnique({ where: { id: params.shopId }, select: { name: true } });
      shopName = shop?.name;
    }
    const filterSummary = renderFilterSummary({
      Search: params.search,
      Shop: shopName,
      Status: params.status ? params.status.replace(/_/g, ' ') : undefined,
      'Date From': params.dateFrom ? new Date(params.dateFrom).toLocaleDateString('en-IN') : undefined,
      'Date To': params.dateTo ? new Date(params.dateTo).toLocaleDateString('en-IN') : undefined,
      'Payment Status': params.paymentStatus,
    });

    const totalsSummary = hide
      ? ''
      : `<div class="summary">
      <div><div class="label">Total Orders</div><div class="value">${orders.length}</div></div>
      <div><div class="label">Total Value</div><div class="value">Rs. ${filtered.reduce((s, o) => s + Number(o.totalAmount ?? 0), 0).toLocaleString('en-IN')}</div></div>
      <div><div class="label">Total Paid</div><div class="value" style="color:#15803d">Rs. ${filtered.reduce((s, o) => s + Number(o.receivedAmount ?? 0), 0).toLocaleString('en-IN')}</div></div>
      <div><div class="label">Balance Due</div><div class="value" style="color:#b91c1c">Rs. ${filtered.reduce((s, o) => s + Number(o.balanceAmount ?? 0), 0).toLocaleString('en-IN')}</div></div>
    </div>`;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${REPORT_PDF_STYLES}</style></head>
<body>
  ${renderReportHeader('Party Orders')}
  <div class="body">
    ${filterSummary}
    ${totalsSummary}
    <table>
      <thead><tr><th>S.No</th><th>Job No</th><th>Dealer/Shop</th><th>Date</th><th>Products</th>${hide ? '' : '<th style="text-align:right">Total</th><th style="text-align:right">Received</th><th style="text-align:right">Balance</th>'}<th>Status</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="${hide ? 6 : 9}" style="text-align:center;color:#9ca3af;padding:16px">No party orders found</td></tr>`}</tbody>
    </table>
    ${renderGeneratedFooter(orders.length, 'order')}
  </div>
</body></html>`;
    return this.pdf.renderHtmlToPdf(html);
  }

  // Same filtered dataset as the PDF/list, as CSV - always the COMPLETE
  // filtered set (not one page), matching what "Download PDF" already
  // guarantees. No Excel library exists anywhere in this codebase; this
  // follows the one existing backend export precedent (ReportsService.toCsv)
  // exactly, rather than introducing a new dependency for the first time.
  async generateListCsv(params: {
    status?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    shopId?: string;
    paymentStatus?: 'SETTLED' | 'DUE';
    viewerRole?: Role;
  }): Promise<string> {
    const hide = params.viewerRole ? HIDE_FINANCIALS_FOR.includes(params.viewerRole) : false;
    const filtered = await this.getFilteredOrders(params);

    const rows: Record<string, unknown>[] = [];
    for (const o of filtered as any[]) {
      const base = {
        'Job No': o.jobNumber ?? o.cotNo ?? o.id,
        Shop: o.shopName,
        Date: new Date(o.orderDate).toISOString().slice(0, 10),
        Phone: o.phone ?? '',
        Status: String(o.deliveryStatus).replace(/_/g, ' '),
      };
      if (o.items?.length) {
        for (const item of o.items) {
          rows.push({
            ...base,
            'Model No': item.modelNo ?? '',
            Product: item.productName,
            Qty: item.qty,
            ...(hide ? {} : { 'Line Total': Number(item.totalValue ?? 0) }),
            ...(hide
              ? {}
              : {
                  'Order Total': Number(o.totalAmount ?? 0),
                  Paid: Number(o.receivedAmount ?? 0),
                  Balance: Number(o.balanceAmount ?? 0),
                }),
          });
        }
      } else {
        rows.push({
          ...base,
          'Model No': o.cotNo ?? '',
          Product: o.model ?? '',
          Qty: o.qty ?? 1,
          ...(hide
            ? {}
            : {
                'Order Total': Number(o.totalAmount ?? 0),
                Paid: Number(o.receivedAmount ?? 0),
                Balance: Number(o.balanceAmount ?? 0),
              }),
        });
      }
    }

    if (!hide) {
      rows.push({
        'Job No': 'TOTAL',
        Shop: `${filtered.length} order(s)`,
        Date: '',
        Phone: '',
        Status: '',
        'Model No': '',
        Product: '',
        Qty: '',
        'Order Total': filtered.reduce((s, o) => s + Number(o.totalAmount ?? 0), 0),
        Paid: filtered.reduce((s, o) => s + Number(o.receivedAmount ?? 0), 0),
        Balance: filtered.reduce((s, o) => s + Number(o.balanceAmount ?? 0), 0),
      });
    }

    return this.toCsv(rows);
  }

  // Shop Dashboard's own report - Product Supply Details (one row per item,
  // reusing the exact column set the single-order PDF already uses) plus a
  // Payment Ledger, both scoped to this shop and whatever filters are
  // active. Reuses the same getFilteredOrders() as the dashboard's own
  // screen data, so the PDF can never show a different row count or total
  // than what's on screen for the same filter set.
  async generateShopPdf(
    shopId: string,
    params: {
      status?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
      paymentStatus?: 'SETTLED' | 'DUE';
      viewerRole?: Role;
    },
  ): Promise<Buffer> {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Shop not found');

    const hide = params.viewerRole ? HIDE_FINANCIALS_FOR.includes(params.viewerRole) : false;
    const filteredOrders = await this.getFilteredOrders({ ...params, shopId });
    const summary = summarizeShopOrders(shop, filteredOrders);
    const supplyRows = buildSupplyRows(filteredOrders, hide);
    const ledgerRows = buildPaymentLedger(filteredOrders, summary.totalValue, hide);

    const rupees = (n: number) => `Rs. ${n.toLocaleString('en-IN')}`;

    const supplyBody = supplyRows
      .map(
        (r, idx) => `<tr>
          <td>${idx + 1}</td>
          <td>${new Date(r.date).toLocaleDateString('en-IN')}</td>
          <td>${escapeHtml(r.order)}</td>
          <td>${escapeHtml(r.finish ?? '-')}</td>
          <td>${escapeHtml(r.size ?? '-')}</td>
          <td>${escapeHtml(r.pattern ?? '-')}</td>
          ${hide ? '' : `<td style="text-align:right">${r.price != null ? rupees(r.price) : '-'}</td>`}
          <td>${escapeHtml(r.modelNo ?? '-')}</td>
          ${hide ? '' : `<td style="text-align:right">${r.value != null ? rupees(r.value) : '-'}</td>`}
        </tr>`,
      )
      .join('');

    const ledgerBody = ledgerRows
      .map(
        (r) => `<tr>
          <td>${new Date(r.date).toLocaleDateString('en-IN')}</td>
          <td>${escapeHtml(r.voucherNo ?? '-')}</td>
          <td style="text-align:right">${rupees(r.orderValue)}</td>
          <td style="text-align:right">${rupees(r.amount)}</td>
          <td>${escapeHtml(r.mode ?? '-')}</td>
          <td style="text-align:right">${rupees(r.balance)}</td>
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

    const paymentSection = hide
      ? ''
      : `<h2 style="font-size:14px;margin:22px 0 10px">Payment Details</h2>
    <div class="summary">
      <div><div class="label">Total Order Value</div><div class="value">${rupees(summary.totalValue)}</div></div>
      <div><div class="label">Total Paid</div><div class="value" style="color:#15803d">${rupees(summary.totalPaid)}</div></div>
      <div><div class="label">Balance</div><div class="value" style="color:#b91c1c">${rupees(summary.balanceDue)}</div></div>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Bill No / Voucher No</th><th style="text-align:right">Order Value</th><th style="text-align:right">Payment</th><th>Mode</th><th style="text-align:right">Balance</th></tr></thead>
      <tbody>${ledgerBody || '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:16px">No payments recorded</td></tr>'}</tbody>
    </table>`;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${REPORT_PDF_STYLES}</style></head>
<body>
  <div class="header">
    <h1>${escapeHtml(shop.name)}</h1>
    <p>SSS Company${shop.contactPhone ? ` &middot; ${escapeHtml(shop.contactPhone)}` : ''} &middot; Product Supply Details</p>
  </div>
  <div class="body">
    ${filterSummary}
    <table>
      <thead><tr><th>S.No</th><th>Date</th><th>Order</th><th>Finish</th><th>Size</th><th>Pattern</th>${hide ? '' : '<th style="text-align:right">Price</th>'}<th>M.No</th>${hide ? '' : '<th style="text-align:right">Value</th>'}</tr></thead>
      <tbody>${supplyBody || `<tr><td colspan="${hide ? 7 : 9}" style="text-align:center;color:#9ca3af;padding:16px">No items found</td></tr>`}</tbody>
    </table>
    ${hide ? '' : `<div class="summary"><div><div class="label">Total Order Value</div><div class="value">${rupees(summary.totalValue)}</div></div></div>`}
    ${paymentSection}
    ${renderGeneratedFooter(supplyRows.length, 'item')}
  </div>
</body></html>`;
    return this.pdf.renderHtmlToPdf(html);
  }

  // Same filtered Product Supply Details rows as generateShopPdf, as CSV -
  // always the complete filtered set, never one page. Bottom rows carry
  // Total Order Value / Total Paid / Balance, same numbers as the PDF and
  // the dashboard's own filteredSummary for this same param set.
  async generateShopCsv(
    shopId: string,
    params: {
      status?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
      paymentStatus?: 'SETTLED' | 'DUE';
      viewerRole?: Role;
    },
  ): Promise<string> {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Shop not found');

    const hide = params.viewerRole ? HIDE_FINANCIALS_FOR.includes(params.viewerRole) : false;
    const filteredOrders = await this.getFilteredOrders({ ...params, shopId });
    const summary = summarizeShopOrders(shop, filteredOrders);
    const supplyRows = buildSupplyRows(filteredOrders, hide);

    const rows: Record<string, unknown>[] = supplyRows.map((r, idx) => ({
      'S.No': idx + 1,
      Date: new Date(r.date).toISOString().slice(0, 10),
      Order: r.order,
      Finish: r.finish ?? '',
      Size: r.size ?? '',
      Pattern: r.pattern ?? '',
      ...(hide ? {} : { Price: r.price ?? '' }),
      'Model No': r.modelNo ?? '',
      ...(hide ? {} : { Value: r.value ?? '' }),
    }));

    if (!hide) {
      rows.push({
        'S.No': '',
        Date: '',
        Order: 'TOTAL ORDER VALUE',
        Finish: '',
        Size: '',
        Pattern: '',
        Price: '',
        'Model No': '',
        Value: summary.totalValue,
      });
      rows.push({
        'S.No': '',
        Date: '',
        Order: 'TOTAL PAID',
        Finish: '',
        Size: '',
        Pattern: '',
        Price: '',
        'Model No': '',
        Value: summary.totalPaid,
      });
      rows.push({
        'S.No': '',
        Date: '',
        Order: 'BALANCE',
        Finish: '',
        Size: '',
        Pattern: '',
        Price: '',
        'Model No': '',
        Value: summary.balanceDue,
      });
    }

    return this.toCsv(rows);
  }

  private toCsv(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
  }
}
