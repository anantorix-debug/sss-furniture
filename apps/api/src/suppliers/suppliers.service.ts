import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const suppliers = await this.prisma.supplier.findMany({
      include: { purchases: true, payments: true },
      orderBy: { name: 'asc' },
    });

    return suppliers.map((s) => {
      const totalPurchaseValue = s.purchases.reduce((sum, p) => sum + Number(p.value), 0);
      const totalPaid = s.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      return {
        id: s.id,
        name: s.name,
        phone: s.phone,
        address: s.address,
        totalPurchaseValue,
        totalPaid,
        balance: totalPurchaseValue - totalPaid,
      };
    });
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        purchases: { orderBy: { date: 'asc' } },
        payments: { orderBy: { date: 'asc' } },
      },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const totalPurchaseValue = supplier.purchases.reduce((sum, p) => sum + Number(p.value), 0);

    let running = 0;
    const paymentsWithBalance = supplier.payments.map((p) => {
      running += Number(p.amount);
      return { ...p, balanceAfter: totalPurchaseValue - running };
    });

    const totalPaid = running;

    return {
      ...supplier,
      payments: paymentsWithBalance,
      totalPurchaseValue,
      totalPaid,
      balance: totalPurchaseValue - totalPaid,
    };
  }

  async create(dto: CreateSupplierDto) {
    const existing = await this.prisma.supplier.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A supplier with this name already exists');
    return this.prisma.supplier.create({ data: dto });
  }

  async update(id: string, dto: UpdateSupplierDto) {
    await this.findOne(id);
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.supplier.delete({ where: { id } });
    return { success: true };
  }

  async addPurchase(supplierId: string, dto: CreatePurchaseDto, userId: string) {
    await this.findOne(supplierId);
    await this.prisma.supplierPurchase.create({
      data: {
        supplierId,
        date: new Date(dto.date),
        particulars: dto.particulars,
        qty: dto.qty,
        price: dto.price,
        value: dto.value,
        createdById: userId,
      },
    });
    return this.findOne(supplierId);
  }

  async removePurchase(supplierId: string, purchaseId: string) {
    const purchase = await this.prisma.supplierPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase || purchase.supplierId !== supplierId) throw new NotFoundException('Purchase entry not found');
    await this.prisma.supplierPurchase.delete({ where: { id: purchaseId } });
    return this.findOne(supplierId);
  }

  async addPayment(supplierId: string, dto: CreateSupplierPaymentDto, userId: string) {
    await this.findOne(supplierId);
    await this.prisma.supplierPayment.create({
      data: {
        supplierId,
        date: new Date(dto.date),
        particulars: dto.particulars,
        voucherNo: dto.voucherNo,
        amount: dto.amount,
        mode: dto.mode,
        createdById: userId,
      },
    });
    return this.findOne(supplierId);
  }

  async removePayment(supplierId: string, paymentId: string) {
    const payment = await this.prisma.supplierPayment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.supplierId !== supplierId) throw new NotFoundException('Payment not found');
    await this.prisma.supplierPayment.delete({ where: { id: paymentId } });
    return this.findOne(supplierId);
  }
}
