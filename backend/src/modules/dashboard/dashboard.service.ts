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

  // Daily series for the dashboard's trend charts (Order Trends, Payments
  // Received, Production Completed) - bucketed in JS rather than SQL date
  // grouping, since this app's data volumes are small enough that fetching
  // the raw rows and bucketing them is simpler and just as fast as a raw
  // query, and stays portable if the DB engine ever changes.
  async getTrends(days: number) {
    const clampedDays = Math.min(Math.max(days, 1), 90);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (clampedDays - 1));

    const [customerOrders, partyOrders, customerPayments, partyPayments, completedWork] = await Promise.all([
      this.prisma.customerOrder.findMany({ where: { orderDate: { gte: start } }, select: { orderDate: true } }),
      this.prisma.partyOrder.findMany({ where: { orderDate: { gte: start } }, select: { orderDate: true } }),
      this.prisma.customerOrderPayment.findMany({ where: { date: { gte: start } }, select: { date: true, amount: true } }),
      this.prisma.partyOrderPayment.findMany({ where: { date: { gte: start } }, select: { date: true, amount: true } }),
      this.prisma.carpenterWorkItem.findMany({
        where: { status: 'COMPLETED', finishedAt: { gte: start } },
        select: { finishedAt: true, quantity: true },
      }),
    ]);

    // Local calendar date, not toISOString().slice(0, 10) - that converts
    // to UTC first, which silently shifts every bucket back a day for any
    // server running in a positive UTC offset (e.g. IST), mislabeling
    // "today" as "yesterday".
    const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const buckets = new Map<string, { date: string; customerOrders: number; partyOrders: number; paymentsReceived: number; productionCompleted: number }>();
    for (let i = 0; i < clampedDays; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const key = dayKey(d);
      buckets.set(key, { date: key, customerOrders: 0, partyOrders: 0, paymentsReceived: 0, productionCompleted: 0 });
    }

    for (const o of customerOrders) {
      const b = buckets.get(dayKey(new Date(o.orderDate)));
      if (b) b.customerOrders += 1;
    }
    for (const o of partyOrders) {
      const b = buckets.get(dayKey(new Date(o.orderDate)));
      if (b) b.partyOrders += 1;
    }
    for (const p of customerPayments) {
      const b = buckets.get(dayKey(new Date(p.date)));
      if (b) b.paymentsReceived += Number(p.amount);
    }
    for (const p of partyPayments) {
      const b = buckets.get(dayKey(new Date(p.date)));
      if (b) b.paymentsReceived += Number(p.amount);
    }
    for (const w of completedWork) {
      if (!w.finishedAt) continue;
      const b = buckets.get(dayKey(new Date(w.finishedAt)));
      if (b) b.productionCompleted += w.quantity;
    }

    return Array.from(buckets.values());
  }
}
