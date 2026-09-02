import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../common/enums/role.enum';
import { computeBalance } from '../common/utils/balance.util';

const HIDE_FINANCIALS_FOR: Role[] = [Role.CARPENTER, Role.POLISHER];

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  // Global Search is Model No-only: it matches CustomerOrder.cotTrack,
  // PartyOrder.cotNo, Product.modelNo, and CarpenterWorkItem.modelNo - the
  // four places "Model No" is stored - and nothing else (no Order ID, phone,
  // or customer name matching). Model No is the single key that ties order,
  // production, employee, and delivery/payment history together.
  async track(modelNo: string, viewerRole?: Role) {
    const hideFinancials = viewerRole ? HIDE_FINANCIALS_FOR.includes(viewerRole) : false;
    const trimmed = modelNo.trim();

    const [product, customerOrders, partyOrders, workItems] = await Promise.all([
      this.prisma.product.findFirst({ where: { modelNo: trimmed } }),
      this.prisma.customerOrder.findMany({
        where: { cotTrack: trimmed },
        include: {
          payments: true,
          createdBy: { select: { name: true } },
          assignedEmployee: { select: { name: true } },
          modelNoUpdatedBy: { select: { name: true } },
        },
        orderBy: { orderDate: 'desc' },
      }),
      this.prisma.partyOrder.findMany({
        where: { cotNo: trimmed },
        include: {
          payments: true,
          createdBy: { select: { name: true } },
          assignedEmployee: { select: { name: true } },
          modelNoUpdatedBy: { select: { name: true } },
        },
        orderBy: { orderDate: 'desc' },
      }),
      this.prisma.carpenterWorkItem.findMany({
        where: { modelNo: trimmed },
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
          include: { purchaseOrder: { include: { supplier: { select: { name: true, phone: true } } } } },
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
      found: Boolean(product || customerOrders.length || partyOrders.length || workItems.length),
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
            poNumber: h.purchaseOrder?.poNumber ?? null,
            supplierName: h.purchaseOrder?.supplier?.name ?? null,
            supplierPhone: h.purchaseOrder?.supplier?.phone ?? null,
            ...(hideFinancials ? {} : { unitCost: h.unitCost ? Number(h.unitCost) : null }),
          })),
        })),
      })),
    };
  }
}
