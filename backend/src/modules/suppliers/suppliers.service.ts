import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
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
        purchases: {
          orderBy: { date: 'asc' },
          include: { rawMaterial: { select: { id: true, name: true, unit: true, measurementKind: true } } },
        },
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
    const supplier = await this.findOne(id);
    // MySQL FK constraints aren't guaranteed to have actually been created
    // by `prisma db push` on every table (confirmed missing on at least one
    // other relation in this project, including PurchaseOrder.supplierId -
    // hit live as an orphaned-row crash) - blocking instead of relying on
    // the schema's onDelete/Restrict semantics avoids silently orphaning
    // purchase/payment/PO rows.
    const purchaseOrderCount = await this.prisma.purchaseOrder.count({ where: { supplierId: id } });
    if (supplier.purchases.length > 0 || supplier.payments.length > 0 || purchaseOrderCount > 0) {
      throw new ConflictException(
        'This supplier has purchase orders or payment history and cannot be deleted. Remove those entries first if you really need to delete the supplier.',
      );
    }
    await this.prisma.supplier.delete({ where: { id } });
    return { success: true };
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
