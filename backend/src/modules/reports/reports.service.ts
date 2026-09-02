import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function dateRange(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined };
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async salesReport(params: { from?: string; to?: string; channel?: 'CUSTOMER' | 'PARTY' | 'ALL' }) {
    const range = dateRange(params.from, params.to);
    const channel = params.channel ?? 'ALL';

    const [customerOrders, partyOrders] = await Promise.all([
      channel !== 'PARTY'
        ? this.prisma.customerOrder.findMany({ where: { orderDate: range }, include: { payments: true } })
        : [],
      channel !== 'CUSTOMER'
        ? this.prisma.partyOrder.findMany({ where: { orderDate: range }, include: { payments: true } })
        : [],
    ]);

    const rows = [
      ...customerOrders.map((o) => ({
        channel: 'Retail' as const,
        date: o.orderDate,
        reference: o.orderId,
        party: o.customerName,
        value: Number(o.orderValue),
        received: o.payments.reduce((s, p) => s + Number(p.amount), 0),
        status: o.deliveryStatus,
      })),
      ...partyOrders.map((o) => ({
        channel: 'Wholesale' as const,
        date: o.orderDate,
        reference: o.cotNo ?? o.id.slice(0, 8),
        party: o.shopName,
        value: Number(o.totalAmount),
        received: o.payments.reduce((s, p) => s + Number(p.amount), 0),
        status: o.deliveryStatus,
      })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    const totalValue = rows.reduce((s, r) => s + r.value, 0);
    const totalReceived = rows.reduce((s, r) => s + r.received, 0);

    return { rows, count: rows.length, totalValue, totalReceived, totalBalance: totalValue - totalReceived };
  }

  async profitAndLoss(params: { from?: string; to?: string }) {
    const range = dateRange(params.from, params.to);

    const [customerPayments, partyPayments, supplierPurchases, carpenterPayments] = await Promise.all([
      this.prisma.customerOrderPayment.findMany({ where: { date: range } }),
      this.prisma.partyOrderPayment.findMany({ where: { date: range } }),
      this.prisma.supplierPurchase.findMany({ where: { date: range } }),
      this.prisma.carpenterPayment.findMany({ where: { date: range } }),
    ]);

    const retailRevenue = customerPayments.reduce((s, p) => s + Number(p.amount), 0);
    const wholesaleRevenue = partyPayments.reduce((s, p) => s + Number(p.amount), 0);
    const materialCost = supplierPurchases.reduce((s, p) => s + Number(p.value), 0);
    const labourCost = carpenterPayments.reduce((s, p) => s + Number(p.amount), 0);

    const totalRevenue = retailRevenue + wholesaleRevenue;
    const totalCost = materialCost + labourCost;

    return {
      revenue: { retail: retailRevenue, wholesale: wholesaleRevenue, total: totalRevenue },
      costs: { materials: materialCost, labour: labourCost, total: totalCost },
      profit: totalRevenue - totalCost,
    };
  }

  toCsv(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const escape = (v: unknown) => {
      const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
  }
}
