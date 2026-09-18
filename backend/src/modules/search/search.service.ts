import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { Role } from '../../common/enums/role.enum';
import { computeBalance } from '../../common/utils/balance.util';
import { escapeHtml, REPORT_PDF_STYLES, renderReportHeader, renderGeneratedFooter } from '../../common/utils/pdf-report.util';

const HIDE_FINANCIALS_FOR: Role[] = [Role.CARPENTER, Role.CARVER, Role.POLISHER];

@Injectable()
export class SearchService {
  constructor(
    private prisma: PrismaService,
    private pdf: PdfService,
  ) {}

  // Global Search is Model No-only: it matches CustomerOrder.cotTrack,
  // PartyOrder.cotNo (legacy single-product rows) / PartyOrderItem.modelNo
  // (current multi-line rows), Product.modelNo, and CarpenterWorkItem.modelNo
  // - the places "Model No" is stored - and nothing else (no Order ID,
  // phone, or customer name matching). Model No is the single key that ties
  // order, production, employee, and delivery/payment history together.
  async track(modelNo: string, viewerRole?: Role) {
    const hideFinancials = viewerRole ? HIDE_FINANCIALS_FOR.includes(viewerRole) : false;
    const trimmed = modelNo.trim();

    const [product, customerOrders, partyOrders, partyOrderItems, workItems] = await Promise.all([
      this.prisma.product.findFirst({ where: { modelNo: { contains: trimmed } } }),
      this.prisma.customerOrder.findMany({
        // cotTrack can be a combined value (e.g. "JOB-2026-00008, 309" when
        // an order has multiple items, each with its own Model No joined
        // back into one string) - contains, not equals, so searching for
        // just one of those Model Nos still finds the order.
        where: { cotTrack: { contains: trimmed } },
        include: {
          payments: true,
          createdBy: { select: { name: true } },
          assignedEmployee: { select: { name: true } },
          modelNoUpdatedBy: { select: { name: true } },
        },
        orderBy: { orderDate: 'desc' },
      }),
      this.prisma.partyOrder.findMany({
        where: { cotNo: { contains: trimmed } },
        include: {
          payments: true,
          createdBy: { select: { name: true } },
          assignedEmployee: { select: { name: true } },
          modelNoUpdatedBy: { select: { name: true } },
        },
        orderBy: { orderDate: 'desc' },
      }),
      this.prisma.partyOrderItem.findMany({
        where: { modelNo: { contains: trimmed } },
        include: {
          order: { include: { payments: true, createdBy: { select: { name: true } } } },
          modelNoUpdatedBy: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.carpenterWorkItem.findMany({
        where: { modelNo: { contains: trimmed } },
        include: {
          carpenter: { select: { name: true, phone: true, workerType: true } },
          createdBy: { select: { name: true } },
          stockMovements: {
            where: { type: 'OUT' },
            include: { rawMaterial: { select: { id: true, name: true, unit: true, type: true } } },
          },
        },
        orderBy: { workDate: 'asc' },
      }),
    ]);

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
      found: Boolean(product || customerOrders.length || partyOrders.length || partyOrderItems.length || workItems.length),
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
        completedDate: w.status === 'COMPLETED' ? w.updatedAt : null,
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
    };
  }

  // Same "order -> production -> employee -> delivery" data the Track page
  // itself shows, just as a PDF - reuses track() rather than re-querying, so
  // the PDF can never drift from what's on screen.
  async generateTrackPdf(modelNo: string, viewerRole?: Role): Promise<Buffer> {
    const result = await this.track(modelNo, viewerRole);
    const fmt = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleDateString('en-IN') : '-');

    const customerOrderRows = result.customerOrders
      .map(
        (o) => `<tr>
          <td>${escapeHtml(o.orderId)}</td>
          <td>${escapeHtml(o.customerName)}</td>
          <td>${escapeHtml(o.product)}</td>
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
          <td>${fmt(w.assignedDate)}</td>
          <td>${fmt(w.completedDate)}</td>
        </tr>`,
      )
      .join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${REPORT_PDF_STYLES}</style></head>
<body>
  ${renderReportHeader(`Model No "${escapeHtml(result.query)}"`)}
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
      workItemRows
        ? `<h3>Production / Employee History</h3><table>
      <thead><tr><th>Stage</th><th>Product</th><th>Employee</th><th>Qty</th><th>Status</th><th>Assigned Date</th><th>Completed Date</th></tr></thead>
      <tbody>${workItemRows}</tbody>
    </table>`
        : ''
    }
    ${!result.found ? '<p style="color:#9ca3af">No order, product, or production record found for this Model No.</p>' : ''}
    ${renderGeneratedFooter(result.customerOrders.length + result.partyOrders.length + result.partyOrderItems.length, 'matching record')}
  </div>
</body></html>`;
    return this.pdf.renderHtmlToPdf(html);
  }
}
