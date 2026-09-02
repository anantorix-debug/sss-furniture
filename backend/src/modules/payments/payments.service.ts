import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type PaymentSource = 'CUSTOMER_ORDER' | 'PARTY_ORDER' | 'SUPPLIER' | 'CARPENTER';

export interface UnifiedPayment {
  id: string;
  source: PaymentSource;
  date: Date;
  amount: number;
  mode: string | null;
  note: string | null;
  relatedName: string;
  relatedId: string;
  direction: 'IN' | 'OUT';
}

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(params: { source?: PaymentSource; from?: string; to?: string; search?: string }) {
    const dateFilter =
      params.from || params.to
        ? { gte: params.from ? new Date(params.from) : undefined, lte: params.to ? new Date(params.to) : undefined }
        : undefined;

    const [customerPayments, partyPayments, supplierPayments, carpenterPayments] = await Promise.all([
      !params.source || params.source === 'CUSTOMER_ORDER'
        ? this.prisma.customerOrderPayment.findMany({
            where: { date: dateFilter },
            include: { order: { select: { id: true, orderId: true, customerName: true } } },
          })
        : [],
      !params.source || params.source === 'PARTY_ORDER'
        ? this.prisma.partyOrderPayment.findMany({
            where: { date: dateFilter },
            include: { order: { select: { id: true, shopName: true } } },
          })
        : [],
      !params.source || params.source === 'SUPPLIER'
        ? this.prisma.supplierPayment.findMany({ where: { date: dateFilter }, include: { supplier: { select: { id: true, name: true } } } })
        : [],
      !params.source || params.source === 'CARPENTER'
        ? this.prisma.carpenterPayment.findMany({ where: { date: dateFilter }, include: { carpenter: { select: { id: true, name: true } } } })
        : [],
    ]);

    const unified: UnifiedPayment[] = [
      ...customerPayments.map((p) => ({
        id: p.id,
        source: 'CUSTOMER_ORDER' as const,
        date: p.date,
        amount: Number(p.amount),
        mode: p.mode,
        note: p.note ?? `Order ${p.order.orderId}`,
        relatedName: p.order.customerName,
        relatedId: p.order.id,
        direction: 'IN' as const,
      })),
      ...partyPayments.map((p) => ({
        id: p.id,
        source: 'PARTY_ORDER' as const,
        date: p.date,
        amount: Number(p.amount),
        mode: p.mode,
        note: p.note,
        relatedName: p.order.shopName,
        relatedId: p.order.id,
        direction: 'IN' as const,
      })),
      ...supplierPayments.map((p) => ({
        id: p.id,
        source: 'SUPPLIER' as const,
        date: p.date,
        amount: Number(p.amount),
        mode: p.mode,
        note: p.particulars,
        relatedName: p.supplier.name,
        relatedId: p.supplier.id,
        direction: 'OUT' as const,
      })),
      ...carpenterPayments.map((p) => ({
        id: p.id,
        source: 'CARPENTER' as const,
        date: p.date,
        amount: Number(p.amount),
        mode: p.mode,
        note: p.note,
        relatedName: p.carpenter.name,
        relatedId: p.carpenter.id,
        direction: 'OUT' as const,
      })),
    ];

    const filtered = params.search
      ? unified.filter((p) => p.relatedName.toLowerCase().includes(params.search!.toLowerCase()))
      : unified;

    filtered.sort((a, b) => b.date.getTime() - a.date.getTime());

    const totalIn = filtered.filter((p) => p.direction === 'IN').reduce((s, p) => s + p.amount, 0);
    const totalOut = filtered.filter((p) => p.direction === 'OUT').reduce((s, p) => s + p.amount, 0);

    return { payments: filtered, totalIn, totalOut, net: totalIn - totalOut };
  }
}
