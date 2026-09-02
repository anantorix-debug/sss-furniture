import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';
import { paginate, toSkipTake } from '../../common/utils/pagination.util';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  // Opt-in pagination - see the identical note on CustomerOrdersService.findAll.
  async findAll(params: { search?: string; page?: number; limit?: number } = {}) {
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where: Prisma.SupplierWhereInput = params.search ? { name: { contains: params.search } } : {};

    const [suppliers, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        include: { purchases: true, payments: true },
        orderBy: { name: 'asc' },
        ...(paginated ? toSkipTake(page, limit) : {}),
      }),
      paginated ? this.prisma.supplier.count({ where }) : Promise.resolve(0),
    ]);

    const mapped = suppliers.map((s) => {
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
    return paginated ? paginate(mapped, total, page, limit) : mapped;
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

  // Devi Ply Wood / Timber Hari sheets are always qty * price = value
  // exactly - so whenever both are given, that's what we store, ignoring
  // whatever the client sent for value. Lump-sum lines with no qty/price
  // (e.g. a flat "RENT" entry) keep the manually entered value.
  private computeValue(qty: number | undefined, price: number | undefined, fallback: number | undefined): number {
    if (qty != null && price != null) return qty * price;
    if (fallback == null) throw new BadRequestException('Enter a value, or provide both qty and price so it can be calculated');
    return fallback;
  }

  async addPurchase(supplierId: string, dto: CreatePurchaseDto, userId: string) {
    await this.findOne(supplierId);
    await this.prisma.supplierPurchase.create({
      data: {
        supplierId,
        date: new Date(dto.date),
        particulars: dto.particulars,
        qty: dto.qty,
        unit: dto.unit,
        price: dto.price,
        value: this.computeValue(dto.qty, dto.price, dto.value),
        createdById: userId,
      },
    });
    return this.findOne(supplierId);
  }

  async updatePurchase(supplierId: string, purchaseId: string, dto: Partial<CreatePurchaseDto>) {
    const purchase = await this.prisma.supplierPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase || purchase.supplierId !== supplierId) throw new NotFoundException('Purchase entry not found');
    const qty = dto.qty ?? (purchase.qty != null ? Number(purchase.qty) : undefined);
    const price = dto.price ?? (purchase.price != null ? Number(purchase.price) : undefined);
    await this.prisma.supplierPurchase.update({
      where: { id: purchaseId },
      data: {
        date: dto.date ? new Date(dto.date) : undefined,
        particulars: dto.particulars,
        qty: dto.qty,
        unit: dto.unit,
        price: dto.price,
        value: this.computeValue(qty, price, dto.value ?? Number(purchase.value)),
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

  async updatePayment(supplierId: string, paymentId: string, dto: Partial<CreateSupplierPaymentDto>) {
    const payment = await this.prisma.supplierPayment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.supplierId !== supplierId) throw new NotFoundException('Payment not found');
    await this.prisma.supplierPayment.update({
      where: { id: paymentId },
      data: {
        date: dto.date ? new Date(dto.date) : undefined,
        particulars: dto.particulars,
        voucherNo: dto.voucherNo,
        amount: dto.amount,
        mode: dto.mode,
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
