import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getSummary() {
    const [customerOrders, partyOrders, suppliers, carpenters, customerPayments, partyPayments, supplierPurchases, supplierPayments] =
      await Promise.all([
        this.prisma.customerOrder.findMany({ select: { orderValue: true, deliveryStatus: true } }),
        this.prisma.partyOrder.findMany({ select: { totalAmount: true, deliveryStatus: true } }),
        this.prisma.supplier.count(),
        this.prisma.carpenter.count(),
        this.prisma.customerOrderPayment.findMany({ select: { amount: true } }),
        this.prisma.partyOrderPayment.findMany({ select: { amount: true } }),
        this.prisma.supplierPurchase.findMany({ select: { value: true } }),
        this.prisma.supplierPayment.findMany({ select: { amount: true } }),
      ]);

    const sum = (arr: { amount?: any; value?: any; orderValue?: any; totalAmount?: any }[], key: string) =>
      arr.reduce((s, x) => s + Number((x as any)[key]), 0);

    const customerOrderValue = sum(customerOrders, 'orderValue');
    const customerReceived = sum(customerPayments, 'amount');
    const partyOrderValue = sum(partyOrders, 'totalAmount');
    const partyReceived = sum(partyPayments, 'amount');
    const purchaseValue = sum(supplierPurchases, 'value');
    const purchasePaid = sum(supplierPayments, 'amount');

    return {
      customerOrders: {
        count: customerOrders.length,
        pending: customerOrders.filter((o) => o.deliveryStatus === 'PENDING').length,
        delivered: customerOrders.filter((o) => o.deliveryStatus === 'DELIVERED').length,
        totalValue: customerOrderValue,
        totalReceived: customerReceived,
        totalBalance: customerOrderValue - customerReceived,
      },
      partyOrders: {
        count: partyOrders.length,
        pending: partyOrders.filter((o) => o.deliveryStatus === 'PENDING').length,
        delivered: partyOrders.filter((o) => o.deliveryStatus === 'DELIVERED').length,
        totalValue: partyOrderValue,
        totalReceived: partyReceived,
        totalBalance: partyOrderValue - partyReceived,
      },
      suppliers: {
        count: suppliers,
        totalPurchaseValue: purchaseValue,
        totalPaid: purchasePaid,
        totalBalance: purchaseValue - purchasePaid,
      },
      carpenters: {
        count: carpenters,
      },
    };
  }
}
