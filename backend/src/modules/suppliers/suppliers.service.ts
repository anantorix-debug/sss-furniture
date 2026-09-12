import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SupplierPurchase } from '@prisma/client';
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
    // The relation is declared onDelete: Cascade in the schema, but MySQL
    // FK constraints aren't guaranteed to have actually been created by
    // `prisma db push` on every table (confirmed missing on at least one
    // other relation in this project) - blocking instead of relying on
    // cascade avoids silently orphaning purchase/payment rows.
    if (supplier.purchases.length > 0 || supplier.payments.length > 0) {
      throw new ConflictException(
        'This supplier has purchase or payment history and cannot be deleted. Remove those entries first if you really need to delete the supplier.',
      );
    }
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

  // D x S x L / 144 per piece, x number of pieces - the standard board-foot
  // formula for raw wood/timber, all dimensions in inches. Recomputed here
  // (never trusts a client-sent total) so the formula is enforced
  // consistently no matter which client called the API.
  private resolveBoardFeet(d: { thicknessIn?: number; widthIn?: number; lengthIn?: number; pieces?: number }): number {
    const { thicknessIn, widthIn, lengthIn, pieces } = d;
    if (thicknessIn == null || widthIn == null || lengthIn == null || pieces == null) {
      throw new BadRequestException('Thickness, width, length and number of pieces are all required for a board-feet material purchase');
    }
    if (thicknessIn <= 0 || widthIn <= 0 || lengthIn <= 0 || pieces <= 0) {
      throw new BadRequestException('Thickness, width, length and pieces must be positive numbers');
    }
    return Math.round(((thicknessIn * widthIn * lengthIn) / 144) * pieces * 100) / 100;
  }

  // The one place addPurchase/updatePurchase resolve the linked RawMaterial
  // (if any), lock the unit server-side, and compute qty/value - so a
  // material link behaves identically whether the purchase is being
  // created or edited. `existing` is passed on update so omitted fields
  // fall back to what's already stored.
  private async resolvePurchaseData(dto: Partial<CreatePurchaseDto>, existing?: SupplierPurchase) {
    const rawMaterialId = dto.rawMaterialId !== undefined ? dto.rawMaterialId : (existing?.rawMaterialId ?? null);

    let material: { id: string; unit: string; measurementKind: string } | null = null;
    if (rawMaterialId) {
      material = await this.prisma.rawMaterial.findUnique({
        where: { id: rawMaterialId },
        select: { id: true, unit: true, measurementKind: true },
      });
      if (!material) throw new NotFoundException('Raw material not found');
    }

    let qty = dto.qty ?? (existing?.qty != null ? Number(existing.qty) : undefined);
    let unit = dto.unit ?? existing?.unit ?? undefined;
    let thicknessIn = dto.thicknessIn ?? (existing?.thicknessIn != null ? Number(existing.thicknessIn) : undefined);
    let widthIn = dto.widthIn ?? (existing?.widthIn != null ? Number(existing.widthIn) : undefined);
    let lengthIn = dto.lengthIn ?? (existing?.lengthIn != null ? Number(existing.lengthIn) : undefined);
    let pieces = dto.pieces ?? existing?.pieces ?? undefined;
    const price = dto.price ?? (existing?.price != null ? Number(existing.price) : undefined);

    if (material) {
      // Client's unit is always ignored once linked - the material's own
      // unit is the only source of truth, so StockMovement/RawMaterial
      // units can never disagree.
      unit = material.unit;
      if (price == null) throw new BadRequestException('Price/Rate is required when linking a purchase to a raw material');

      if (material.measurementKind === 'BOARD_FEET') {
        qty = this.resolveBoardFeet({ thicknessIn, widthIn, lengthIn, pieces });
      } else {
        if (qty == null) throw new BadRequestException('Quantity is required when linking a purchase to a raw material');
        thicknessIn = undefined;
        widthIn = undefined;
        lengthIn = undefined;
        pieces = undefined;
      }
    } else {
      thicknessIn = undefined;
      widthIn = undefined;
      lengthIn = undefined;
      pieces = undefined;
    }

    const value = this.computeValue(qty, price, dto.value ?? (existing ? Number(existing.value) : undefined));
    return { rawMaterialId, qty, unit, price, value, thicknessIn, widthIn, lengthIn, pieces };
  }

  async addPurchase(supplierId: string, dto: CreatePurchaseDto, userId: string) {
    const supplier = await this.findOne(supplierId);
    const r = await this.resolvePurchaseData(dto);

    await this.prisma.$transaction(async (tx) => {
      const created = await tx.supplierPurchase.create({
        data: {
          supplierId,
          date: new Date(dto.date),
          particulars: dto.particulars,
          qty: r.qty,
          unit: r.unit,
          price: r.price,
          value: r.value,
          rawMaterialId: r.rawMaterialId,
          thicknessIn: r.thicknessIn,
          widthIn: r.widthIn,
          lengthIn: r.lengthIn,
          pieces: r.pieces,
          createdById: userId,
        },
      });

      if (r.rawMaterialId) {
        await tx.stockMovement.create({
          data: {
            rawMaterialId: r.rawMaterialId,
            type: 'IN',
            quantity: r.qty!,
            unitCost: r.price,
            reason: `Purchase from ${supplier.name}`,
            supplierPurchaseId: created.id,
            date: new Date(dto.date),
            createdById: userId,
          },
        });
      }
    });

    return this.findOne(supplierId);
  }

  async updatePurchase(supplierId: string, purchaseId: string, dto: Partial<CreatePurchaseDto>, userId: string) {
    const purchase = await this.prisma.supplierPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase || purchase.supplierId !== supplierId) throw new NotFoundException('Purchase entry not found');
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { name: true } });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const r = await this.resolvePurchaseData(dto, purchase);
    const date = dto.date ? new Date(dto.date) : purchase.date;

    await this.prisma.$transaction(async (tx) => {
      // Delete-and-recreate the linked movement rather than diffing fields -
      // simplest correct approach, and handles "material added/changed/
      // removed on edit" in one code path via resolvePurchaseData above.
      await tx.stockMovement.deleteMany({ where: { supplierPurchaseId: purchaseId } });

      await tx.supplierPurchase.update({
        where: { id: purchaseId },
        data: {
          date,
          particulars: dto.particulars,
          qty: r.qty,
          unit: r.unit,
          price: r.price,
          value: r.value,
          rawMaterialId: r.rawMaterialId,
          thicknessIn: r.thicknessIn,
          widthIn: r.widthIn,
          lengthIn: r.lengthIn,
          pieces: r.pieces,
        },
      });

      if (r.rawMaterialId) {
        await tx.stockMovement.create({
          data: {
            rawMaterialId: r.rawMaterialId,
            type: 'IN',
            quantity: r.qty!,
            unitCost: r.price,
            reason: `Purchase from ${supplier.name}`,
            supplierPurchaseId: purchaseId,
            date,
            createdById: userId,
          },
        });
      }
    });

    return this.findOne(supplierId);
  }

  async removePurchase(supplierId: string, purchaseId: string) {
    const purchase = await this.prisma.supplierPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase || purchase.supplierId !== supplierId) throw new NotFoundException('Purchase entry not found');

    // Explicit delete of the linked movement first, not relying on
    // onDelete: SetNull/cascade - see the identical convention on
    // remove() above (MySQL FK constraints aren't guaranteed present from
    // every historical `prisma db push`).
    await this.prisma.$transaction(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { supplierPurchaseId: purchaseId } });
      await tx.supplierPurchase.delete({ where: { id: purchaseId } });
    });

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
