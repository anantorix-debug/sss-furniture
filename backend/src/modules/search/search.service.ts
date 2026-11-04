import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { Role } from '../../common/enums/role.enum';
import { computeBalance } from '../../common/utils/balance.util';
import { escapeHtml, REPORT_PDF_STYLES, renderReportHeader, renderGeneratedFooter } from '../../common/utils/pdf-report.util';

const HIDE_FINANCIALS_FOR: Role[] = [Role.CARPENTER, Role.CARVER, Role.POLISHER];

export type TrackMode = 'model' | 'voucher';
// Matches no rows, without a database round trip for that section.
const NONE = { id: { in: [] as string[] } };
const MAX_INT = 2147483647;

@Injectable()
export class SearchService {
  constructor(
    private prisma: PrismaService,
    private pdf: PdfService,
  ) {}

  // The top bar has one box per kind of number, and each shows only its own
  // kind: a Model No and a voucher can share a number without being related.
  //   model:   products, orders and production (Model No, COT No, Order ID, Job No)
  //   voucher: expenses, worker and supplier payments, purchases and investor
  //            transactions, by voucher / reference number only
  // A plain number must match whole: 999 finds SSS-999 or "JOB-1, 999", never
  // 1999. In the Model No box it is matched against Model Nos alone, so it
  // can't pick up JOB-2026-00999 or an Order ID ending in 999.
  async track(query: string, viewerRole?: Role, mode: TrackMode = 'model') {
    const hideFinancials = viewerRole ? HIDE_FINANCIALS_FOR.includes(viewerRole) : false;
    const isVoucher = mode === 'voucher';
    const trimmed = isVoucher ? query.trim().replace(/^v[\s.-]*(?=\d)/i, '') : query.trim();
    const isNumber = /^\d+$/.test(trimmed);
    const voucherNumberInt = isVoucher && isNumber && Number(trimmed) <= MAX_INT ? Number(trimmed) : null;
    const wholeNumber = new RegExp(`(^|[^0-9A-Za-z])${isNumber ? trimmed : ''}($|[^0-9A-Za-z])`);
    // Text searches stay partial; only a plain number has to match whole.
    const matches = (value: string | null | undefined) => !isNumber || wholeNumber.test(value ?? '');

    const [
      product,
      allCustomerOrders,
      customerOrderItems,
      allPartyOrders,
      allPartyOrderItems,
      expenses,
      allCarpenterPayments,
      allPurchaseOrders,
      allInvestorTransactions,
      allSupplierPayments,
    ] = await Promise.all([
      this.prisma.product.findFirst({ where: isVoucher ? NONE : { modelNo: isNumber ? trimmed : { contains: trimmed } } }),
      this.prisma.customerOrder.findMany({
        where: isVoucher
          ? NONE
          : isNumber
            ? { cotTrack: { contains: trimmed } }
            : {
                OR: [
                  { cotTrack: { contains: trimmed } },
                  { orderId: { contains: trimmed } },
                  { jobNumber: { contains: trimmed } },
                ],
              },
        include: {
          payments: true,
          createdBy: { select: { name: true } },
          assignedEmployee: { select: { name: true } },
          modelNoUpdatedBy: { select: { name: true } },
        },
        orderBy: { orderDate: 'desc' },
      }),
      this.prisma.customerOrderItem.findMany({
        where: isVoucher ? NONE : { product: { modelNo: isNumber ? trimmed : { contains: trimmed } } },
        include: {
          order: { include: { payments: true, createdBy: { select: { name: true } } } },
          product: { select: { modelNo: true } },
          modelNoSetBy: { select: { name: true } },
        },
        orderBy: { order: { orderDate: 'desc' } },
      }),
      this.prisma.partyOrder.findMany({
        where: isVoucher
          ? NONE
          : isNumber
            ? { cotNo: { contains: trimmed } }
            : {
                OR: [
                  { cotNo: { contains: trimmed } },
                  { jobNumber: { contains: trimmed } },
                ],
              },
        include: {
          payments: true,
          createdBy: { select: { name: true } },
          assignedEmployee: { select: { name: true } },
          modelNoUpdatedBy: { select: { name: true } },
        },
        orderBy: { orderDate: 'desc' },
      }),
      this.prisma.partyOrderItem.findMany({
        where: isVoucher ? NONE : { modelNo: { contains: trimmed } },
        include: {
          order: { include: { payments: true, createdBy: { select: { name: true } } } },
          modelNoUpdatedBy: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      // Expense Vouchers
      this.prisma.expense.findMany({
        where: !isVoucher
          ? NONE
          : isNumber
            ? voucherNumberInt !== null
              ? { status: 'ACTIVE', voucherNumber: voucherNumberInt }
              : NONE
            : {
                status: 'ACTIVE',
                OR: [
                  { referenceType: { is: { code: { contains: trimmed } } } },
                  { referenceType: { is: { label: { contains: trimmed } } } },
                ],
              },
        include: {
          category: { select: { id: true, name: true, scope: true } },
          referenceType: { select: { id: true, code: true, label: true } },
          paymentMode: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
        take: 20,
      }),
      // Carpenter Payment Vouchers
      this.prisma.carpenterPayment.findMany({
        where: isVoucher ? { reference: { contains: trimmed } } : NONE,
        include: {
          carpenter: { select: { id: true, name: true, phone: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
        take: isNumber ? undefined : 20,
      }),
      // Purchase Orders
      this.prisma.purchase.findMany({
        where: isVoucher ? { purchaseNumber: { contains: trimmed } } : NONE,
        include: {
          supplier: { select: { id: true, name: true, phone: true } },
          createdBy: { select: { id: true, name: true } },
          items: { select: { quantity: true, unitPrice: true } },
        },
        orderBy: { purchaseDate: 'desc' },
        take: isNumber ? undefined : 20,
      }),
      // Investor Transactions / Vouchers
      this.prisma.investorTransaction.findMany({
        where: isVoucher ? { reference: { contains: trimmed } } : NONE,
        include: {
          investor: { select: { id: true, name: true, phone: true } },
        },
        orderBy: { date: 'desc' },
        take: isNumber ? undefined : 20,
      }),
      // Supplier Payments / Ref Vouchers
      this.prisma.supplierPayment.findMany({
        where: isVoucher ? { voucherNo: { contains: trimmed } } : NONE,
        include: {
          supplier: { select: { id: true, name: true, phone: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
        take: isNumber ? undefined : 20,
      }),
    ]);

    const customerOrders = allCustomerOrders.filter((o) => !isNumber || matches(o.cotTrack));
    const partyOrders = allPartyOrders.filter((o) => !isNumber || matches(o.cotNo));
    const partyOrderItems = allPartyOrderItems.filter((i) => matches(i.modelNo));
    const carpenterPayments = allCarpenterPayments.filter((p) => matches(p.reference)).slice(0, 20);
    const purchaseOrders = allPurchaseOrders.filter((p) => matches(p.purchaseNumber)).slice(0, 20);
    const investorTransactions = allInvestorTransactions.filter((t) => matches(t.reference)).slice(0, 20);
    const supplierPayments = allSupplierPayments.filter((p) => matches(p.voucherNo)).slice(0, 20);

    // A work item's own modelNo can differ from the Model No actually
    // searched: an order's cotTrack is a combined value when it has
    // multiple items (e.g. "JOB-2026-00008, 309"), but each CarpenterWorkItem
    // keeps only the single modelNo that was entered for it - so searching
    // "309" would find the order above yet miss every work item, even
    // though this order clearly has real production history. Once an order
    // is matched, pull its production history by source link too, not just
    // by each work item's own modelNo.
    const matchedCustomerOrderIds = Array.from(new Set([...customerOrders.map((o) => o.id), ...customerOrderItems.map((i) => i.orderId)]));
    const matchedPartyOrderItemIds = partyOrderItems.map((i) => i.id);
    const allWorkItems = await this.prisma.carpenterWorkItem.findMany({
      where: isVoucher
        ? NONE
        : {
            OR: [
              { modelNo: { contains: trimmed } },
              ...(matchedCustomerOrderIds.length ? [{ sourceCustomerOrderId: { in: matchedCustomerOrderIds } }] : []),
              ...(matchedPartyOrderItemIds.length ? [{ sourcePartyOrderItemId: { in: matchedPartyOrderItemIds } }] : []),
            ],
          },
      include: {
        carpenter: { select: { name: true, phone: true, workerType: true } },
        createdBy: { select: { name: true } },
        stockMovements: {
          where: { type: 'OUT' },
          include: { rawMaterial: { select: { id: true, name: true, unit: true, type: true } } },
        },
      },
      orderBy: { workDate: 'asc' },
    });

    const workItems = allWorkItems.filter(
      (w) =>
        matches(w.modelNo) ||
        (w.sourceCustomerOrderId != null && matchedCustomerOrderIds.includes(w.sourceCustomerOrderId)) ||
        (w.sourcePartyOrderItemId != null && matchedPartyOrderItemIds.includes(w.sourcePartyOrderItemId)),
    );

    // Stock is fungible (no per-batch lot tracking), so "which wholesaler
    // supplied this" is answered per raw material, not per issued unit:
    // pull the most recent IN movements (i.e. received purchase orders)
    // for every material actually used across the matched work items.
    const materialIds = Array.from(new Set(workItems.flatMap((w) => w.stockMovements.map((m) => m.rawMaterialId))));
    const purchaseHistory = materialIds.length
      ? await this.prisma.stockMovement.findMany({
          where: { rawMaterialId: { in: materialIds }, type: 'IN' },
          include: { purchase: { include: { supplier: { select: { name: true, phone: true } } } } },
          orderBy: { date: 'desc' },
        })
      : [];
    const historyByMaterial = new Map<string, typeof purchaseHistory>();
    for (const m of purchaseHistory) {
      const list = historyByMaterial.get(m.rawMaterialId) ?? [];
      if (list.length < 5) list.push(m);
      historyByMaterial.set(m.rawMaterialId, list);
    }

    return {
      query: trimmed,
      found: Boolean(
        product ||
          customerOrders.length ||
          customerOrderItems.length ||
          partyOrders.length ||
          partyOrderItems.length ||
          workItems.length ||
          expenses.length ||
          carpenterPayments.length ||
          purchaseOrders.length ||
          investorTransactions.length ||
          supplierPayments.length,
      ),
      product: product
        ? {
            id: product.id,
            sku: product.sku,
            modelNo: product.modelNo,
            name: product.name,
            category: product.category,
            modelSize: product.modelSize,
            materialFinish: product.materialFinish,
            unit: product.unit,
            isActive: product.isActive,
            ...(hideFinancials
              ? {}
              : {
                  retailPrice: Number(product.retailPrice),
                  wholesalePrice: product.wholesalePrice ? Number(product.wholesalePrice) : null,
                  costPrice: product.costPrice ? Number(product.costPrice) : null,
                }),
          }
        : null,
      customerOrders: customerOrders.map((order) => {
        const { totalReceived, balanceAmount } = computeBalance(Number(order.orderValue), order.payments);
        return {
          id: order.id,
          orderId: order.orderId,
          jobNumber: order.jobNumber,
          customerName: order.customerName,
          phone: order.phone,
          address: order.address,
          product: order.product,
          colour: order.colour,
          deliveryStatus: order.deliveryStatus,
          orderDate: order.orderDate,
          expectedDeliveryDate: order.expectedDeliveryDate,
          actualDeliveryDate: order.actualDeliveryDate,
          cotTrack: order.cotTrack,
          carvingRequired: order.carvingRequired,
          specialInstructions: order.specialInstructions,
          createdBy: order.createdBy?.name,
          assignedEmployee: order.assignedEmployee?.name ?? null,
          modelNoUpdatedBy: order.modelNoUpdatedBy?.name ?? null,
          modelNoUpdatedAt: order.modelNoUpdatedAt,
          paymentStatus: balanceAmount <= 0 ? ('SETTLED' as const) : ('DUE' as const),
          ...(hideFinancials ? {} : { orderValue: Number(order.orderValue), totalReceived, balanceAmount }),
        };
      }),
      // Multi-line Customer Order matches via each line's own Catalog Model
      // No (Product link) - separate from customerOrders above (which only
      // matches the order-level cotTrack), same "one entry per matching
      // product line" shape as partyOrderItems below.
      customerOrderItems: customerOrderItems.map((item) => {
        const { totalReceived, balanceAmount } = computeBalance(Number(item.order.orderValue), item.order.payments);
        return {
          id: item.id,
          orderId: item.orderId,
          modelNo: item.product?.modelNo ?? null,
          productName: item.productName,
          category: item.category,
          size: item.size,
          quantity: item.quantity,
          stockReservedQty: item.stockReservedQty,
          productionQty: item.productionQty,
          orderIdLabel: item.order.orderId,
          customerName: item.order.customerName,
          phone: item.order.phone,
          address: item.order.address,
          deliveryStatus: item.order.deliveryStatus,
          orderDate: item.order.orderDate,
          actualDeliveryDate: item.order.actualDeliveryDate,
          createdBy: item.order.createdBy?.name,
          modelNoSetBy: item.modelNoSetBy?.name ?? null,
          modelNoSetAt: item.modelNoSetAt,
          paymentStatus: balanceAmount <= 0 ? ('SETTLED' as const) : ('DUE' as const),
          ...(hideFinancials ? {} : { unitPrice: Number(item.unitPrice), totalReceived, balanceAmount }),
        };
      }),
      partyOrders: partyOrders.map((order) => {
        const { totalReceived, balanceAmount } = computeBalance(Number(order.totalAmount), order.payments);
        return {
          id: order.id,
          cotNo: order.cotNo,
          shopName: order.shopName,
          phone: order.phone,
          model: order.model,
          finish: order.finish,
          qty: order.qty,
          deliveryStatus: order.deliveryStatus,
          orderDate: order.orderDate,
          actualDeliveryDate: order.actualDeliveryDate,
          createdBy: order.createdBy?.name,
          assignedEmployee: order.assignedEmployee?.name ?? null,
          modelNoUpdatedBy: order.modelNoUpdatedBy?.name ?? null,
          modelNoUpdatedAt: order.modelNoUpdatedAt,
          paymentStatus: balanceAmount <= 0 ? ('SETTLED' as const) : ('DUE' as const),
          ...(hideFinancials ? {} : { price: Number(order.price), totalAmount: Number(order.totalAmount), totalReceived, balanceAmount }),
        };
      }),
      // Multi-line Party Order matches (current flow) - one entry per
      // matching product line, each carrying its own order/shop context
      // since a single order can now hold many different Model Nos.
      partyOrderItems: partyOrderItems.map((item) => {
        const { totalReceived, balanceAmount } = computeBalance(Number(item.order.totalAmount), item.order.payments);
        return {
          id: item.id,
          orderId: item.orderId,
          modelNo: item.modelNo,
          productName: item.productName,
          finish: item.finish,
          size: item.size,
          qty: item.qty,
          stockReservedQty: item.stockReservedQty,
          productionQty: item.productionQty,
          shopName: item.order.shopName,
          phone: item.order.phone,
          deliveryStatus: item.order.deliveryStatus,
          orderDate: item.order.orderDate,
          actualDeliveryDate: item.order.actualDeliveryDate,
          createdBy: item.order.createdBy?.name,
          modelNoUpdatedBy: item.modelNoUpdatedBy?.name ?? null,
          modelNoUpdatedAt: item.modelNoUpdatedAt,
          paymentStatus: balanceAmount <= 0 ? ('SETTLED' as const) : ('DUE' as const),
          ...(hideFinancials ? {} : { unitPrice: Number(item.unitPrice), totalValue: Number(item.totalValue), totalReceived, balanceAmount }),
        };
      }),
      workItems: workItems.map((w) => ({
        id: w.id,
        modelNo: w.modelNo,
        stage: w.stage,
        productName: w.productName,
        category: w.category,
        size: w.size,
        quantity: w.quantity,
        status: w.status,
        assignedDate: w.workDate,
        // Real work-timeline dates (same fields the Work Timeline popups use
        // elsewhere) - not derived from updatedAt, which drifts on any edit
        // and misses QUALITY_CHECK (a stage whose own work is genuinely done,
        // just awaiting verification).
        startedAt: w.startedAt,
        finishedAt: w.finishedAt,
        qcNote: w.qcNote,
        photoUrl: w.photoUrl,
        carpenter: w.carpenter ? { name: w.carpenter.name, phone: w.carpenter.phone, workerType: w.carpenter.workerType } : null,
        createdBy: w.createdBy?.name,
        ...(hideFinancials ? {} : { price: Number(w.price), extra: Number(w.extra), total: Number(w.total) }),
        materials: w.stockMovements.map((m) => ({
          id: m.id,
          rawMaterialName: m.rawMaterial.name,
          rawMaterialType: m.rawMaterial.type,
          unit: m.rawMaterial.unit,
          quantityIssued: Math.abs(Number(m.quantity)),
          issuedDate: m.date,
          purchaseHistory: (historyByMaterial.get(m.rawMaterialId) ?? []).map((h) => ({
            date: h.date,
            quantity: Number(h.quantity),
            purchaseNumber: h.purchase?.purchaseNumber ?? null,
            supplierName: h.purchase?.supplier?.name ?? null,
            supplierPhone: h.purchase?.supplier?.phone ?? null,
            ...(hideFinancials ? {} : { unitCost: h.unitCost ? Number(h.unitCost) : null }),
          })),
        })),
      })),
      expenses: expenses.map((e) => ({
        id: e.id,
        voucherNumber: e.voucherNumber,
        date: e.date,
        amount: Number(e.amount),
        particulars: e.particulars,
        reference: e.referenceType?.code ?? null,
        categoryName: e.category.name,
        categoryScope: e.category.scope,
        referenceTypeName: e.referenceType?.label ?? null,
        paymentMode: e.paymentMode.name,
        createdBy: e.createdBy.name,
      })),
      carpenterPayments: carpenterPayments.map((p) => ({
        id: p.id,
        voucherNo: p.reference,
        reference: p.reference,
        date: p.date,
        amount: Number(p.amount),
        mode: p.mode,
        paymentType: p.paymentType,
        carpenterName: p.carpenter.name,
        carpenterPhone: p.carpenter.phone,
        createdBy: p.createdBy?.name ?? null,
      })),
      purchaseOrders: purchaseOrders.map((po) => ({
        id: po.id,
        purchaseNumber: po.purchaseNumber,
        invoiceNumber: po.purchaseNumber,
        date: po.purchaseDate,
        status: po.status,
        supplierName: po.supplier?.name ?? 'Unknown Supplier',
        supplierPhone: po.supplier?.phone ?? null,
        ...(hideFinancials
          ? {}
          : {
              totalAmount: po.items.reduce(
                (sum, it) => sum + Number(it.quantity) * Number(it.unitPrice),
                0,
              ),
            }),
      })),
      investorTransactions: investorTransactions.map((tx) => ({
        id: tx.id,
        type: tx.type,
        date: tx.date,
        amount: Number(tx.amount),
        reference: tx.reference,
        paymentMode: tx.paymentMode,
        notes: tx.notes,
        investorName: tx.investor.name,
      })),
      supplierPayments: supplierPayments.map((sp) => ({
        id: sp.id,
        voucherNo: sp.voucherNo,
        particulars: sp.particulars,
        date: sp.date,
        amount: Number(sp.amount),
        balanceAfter: sp.balanceAfter !== null ? Number(sp.balanceAfter) : null,
        mode: sp.mode,
        supplierId: sp.supplierId,
        supplierName: sp.supplier?.name ?? 'Unknown Supplier',
        supplierPhone: sp.supplier?.phone ?? null,
        createdBy: sp.createdBy?.name ?? null,
      })),
    };
  }

  // Same "order -> production -> employee -> delivery" data the Track page
  // itself shows, just as a PDF - reuses track() rather than re-querying, so
  // the PDF can never drift from what's on screen.
  async generateTrackPdf(modelNo: string, viewerRole?: Role, mode: TrackMode = 'model'): Promise<Buffer> {
    const result = await this.track(modelNo, viewerRole, mode);
    const fmt = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleDateString('en-IN') : '-');

    const customerOrderRows = [...result.customerOrders, ...result.customerOrderItems]
      .map(
        (o: any) => `<tr>
          <td>${escapeHtml(o.orderIdLabel ?? o.orderId ?? '-')}</td>
          <td>${escapeHtml(o.customerName)}</td>
          <td>${escapeHtml(o.product ?? o.productName ?? '-')}</td>
          <td>${fmt(o.orderDate)}</td>
          <td>${escapeHtml(o.deliveryStatus)}</td>
          <td>${fmt(o.actualDeliveryDate)}</td>
        </tr>`,
      )
      .join('');

    const partyOrderRows = [...result.partyOrders, ...result.partyOrderItems]
      .map((o: any) => `<tr>
          <td>${escapeHtml(o.shopName)}</td>
          <td>${escapeHtml(o.productName ?? o.model ?? '-')}</td>
          <td>${fmt(o.orderDate)}</td>
          <td>${escapeHtml(o.deliveryStatus)}</td>
          <td>${fmt(o.actualDeliveryDate)}</td>
        </tr>`)
      .join('');

    const workItemRows = result.workItems
      .map(
        (w) => `<tr>
          <td>${escapeHtml(w.stage)}</td>
          <td>${escapeHtml(w.productName)}</td>
          <td>${escapeHtml(w.carpenter?.name ?? 'Unassigned')}</td>
          <td>${w.quantity}</td>
          <td>${escapeHtml(w.status.replace('_', ' '))}</td>
          <td>${fmt(w.startedAt)}</td>
          <td>${fmt(w.finishedAt)}</td>
        </tr>`,
      )
      .join('');

    const expenseRows = (result.expenses ?? [])
      .map(
        (e: any) => `<tr>
          <td>${e.voucherNumber ? `V-${e.voucherNumber}` : (e.reference ?? '-')}</td>
          <td>${escapeHtml(e.particulars)}</td>
          <td>${escapeHtml(e.categoryName)}</td>
          <td>₹${Number(e.amount).toLocaleString('en-IN')}</td>
          <td>${fmt(e.date)}</td>
          <td>${escapeHtml(e.paymentMode ?? '-')}</td>
        </tr>`,
      )
      .join('');

    const supplierPaymentRows = (result.supplierPayments ?? [])
      .map(
        (sp: any) => `<tr>
          <td>${escapeHtml(sp.voucherNo ?? '-')}</td>
          <td>${escapeHtml(sp.supplierName)}</td>
          <td>${escapeHtml(sp.particulars ?? '-')}</td>
          <td>₹${Number(sp.amount).toLocaleString('en-IN')}</td>
          <td>${fmt(sp.date)}</td>
          <td>${escapeHtml(sp.mode ?? '-')}</td>
        </tr>`,
      )
      .join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${REPORT_PDF_STYLES}</style></head>
<body>
  ${renderReportHeader(`Search & Track Record "${escapeHtml(result.query)}"`)}
  <div class="body">
    ${
      result.product
        ? `<h3>Product</h3><table><tbody><tr><td><b>Model No</b></td><td>${escapeHtml(result.product.modelNo ?? '-')}</td></tr><tr><td><b>Name</b></td><td>${escapeHtml(result.product.name)}</td></tr><tr><td><b>Category</b></td><td>${escapeHtml(result.product.category ?? '-')}</td></tr></tbody></table>`
        : ''
    }
    ${
      customerOrderRows
        ? `<h3>Customer Orders</h3><table>
      <thead><tr><th>Order ID</th><th>Customer</th><th>Product</th><th>Order Date</th><th>Delivery Status</th><th>Delivery Date</th></tr></thead>
      <tbody>${customerOrderRows}</tbody>
    </table>`
        : ''
    }
    ${
      partyOrderRows
        ? `<h3>Party Orders</h3><table>
      <thead><tr><th>Shop</th><th>Product</th><th>Order Date</th><th>Delivery Status</th><th>Delivery Date</th></tr></thead>
      <tbody>${partyOrderRows}</tbody>
    </table>`
        : ''
    }
    ${
      expenseRows
        ? `<h3>Expenses &amp; Vouchers</h3><table>
      <thead><tr><th>Voucher / Ref</th><th>Particulars</th><th>Category</th><th>Amount</th><th>Date</th><th>Mode</th></tr></thead>
      <tbody>${expenseRows}</tbody>
    </table>`
        : ''
    }
    ${
      supplierPaymentRows
        ? `<h3>Supplier Payments &amp; Ref Vouchers</h3><table>
      <thead><tr><th>Ref / Voucher No</th><th>Supplier</th><th>Particulars</th><th>Amount</th><th>Date</th><th>Mode</th></tr></thead>
      <tbody>${supplierPaymentRows}</tbody>
    </table>`
        : ''
    }
    ${
      workItemRows
        ? `<h3>Production / Employee History</h3><table>
      <thead><tr><th>Stage</th><th>Product</th><th>Employee</th><th>Qty</th><th>Status</th><th>Work Started</th><th>Work Finished</th></tr></thead>
      <tbody>${workItemRows}</tbody>
    </table>`
        : ''
    }
    ${!result.found ? '<p style="color:#9ca3af">No order, voucher, product, or production record found.</p>' : ''}
    ${renderGeneratedFooter(result.customerOrders.length + result.partyOrders.length + result.partyOrderItems.length + (result.expenses?.length || 0), 'matching record')}
  </div>
</body></html>`;
    return this.pdf.renderHtmlToPdf(html);
  }
}
