import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { CreateReferenceTypeDto } from './dto/create-reference-type.dto';
import { CreatePaymentModeDto } from './dto/create-payment-mode.dto';

const DEFAULT_REFERENCE_TYPES = [
  { code: 'PUR', label: 'Purchase' },
  { code: 'SAL', label: 'Salary' },
  { code: 'TRA', label: 'Transport' },
  { code: 'EXP', label: 'Expense' },
  { code: 'CMY', label: 'Company Expense' },
  { code: 'EMI', label: 'EMI' },
];

const DEFAULT_PAYMENT_MODES = ['CASH', 'UPI-HDFC', 'IOB', 'Bank Transfer', 'Credit Card', 'Debit Card', 'Cheque', 'Other'];

// name -> reference code, scope ('COMPANY' | 'PERSONAL' | null for either)
const DEFAULT_CATEGORIES: { name: string; refCode: string | null; scope: 'COMPANY' | 'PERSONAL' | null }[] = [
  { name: 'Purchase', refCode: 'PUR', scope: 'COMPANY' },
  { name: 'Salary', refCode: 'SAL', scope: 'COMPANY' },
  { name: 'Transport & Toll', refCode: 'TRA', scope: 'COMPANY' },
  { name: 'Expense', refCode: 'EXP', scope: null },
  { name: 'Company Expense', refCode: 'CMY', scope: 'COMPANY' },
  { name: 'Personal Expense', refCode: null, scope: 'PERSONAL' },
];

// Runs once at startup and is otherwise a no-op (every create is
// `skipDuplicates`) - gives every fresh install the same starting set the
// spec calls out (PUR/SAL/TRA/EXP/CMY/EMI, CASH/UPI-HDFC/IOB/...) without
// needing a manual seed step, while staying fully editable afterward.
@Injectable()
export class ExpenseConfigService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.prisma.expenseReferenceType.createMany({ data: DEFAULT_REFERENCE_TYPES, skipDuplicates: true });
    await this.prisma.expensePaymentMode.createMany({
      data: DEFAULT_PAYMENT_MODES.map((name) => ({ name })),
      skipDuplicates: true,
    });

    const existingCategories = await this.prisma.expenseCategory.count();
    if (existingCategories === 0) {
      const refTypes = await this.prisma.expenseReferenceType.findMany();
      const refByCode = new Map(refTypes.map((r) => [r.code, r.id]));
      for (const cat of DEFAULT_CATEGORIES) {
        await this.prisma.expenseCategory.create({
          data: {
            name: cat.name,
            scope: cat.scope as any,
            defaultReferenceTypeId: cat.refCode ? refByCode.get(cat.refCode) : undefined,
          },
        }).catch(() => null); // ignore races between multiple instances starting simultaneously
      }
    }
  }

  // --- Categories ---------------------------------------------------------

  findAllCategories(includeInactive = false) {
    return this.prisma.expenseCategory.findMany({
      where: includeInactive ? undefined : { isActive: true },
      include: { defaultReferenceType: true },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(dto: CreateExpenseCategoryDto) {
    const existing = await this.prisma.expenseCategory.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A category with this name already exists');
    return this.prisma.expenseCategory.create({ data: dto as any });
  }

  async updateCategory(id: string, dto: Partial<CreateExpenseCategoryDto>) {
    const existing = await this.prisma.expenseCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Category not found');
    return this.prisma.expenseCategory.update({ where: { id }, data: dto as any });
  }

  async removeCategory(id: string) {
    const inUse = await this.prisma.expense.count({ where: { categoryId: id } });
    if (inUse > 0) {
      // Categories in use are disabled, not deleted, so historical expenses
      // keep a valid reference - matches "Enable/disable categories" in the spec.
      return this.updateCategory(id, { isActive: false });
    }
    await this.prisma.expenseCategory.delete({ where: { id } });
    return { success: true };
  }

  // --- Reference types ------------------------------------------------------

  findAllReferenceTypes(includeInactive = false) {
    return this.prisma.expenseReferenceType.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  async createReferenceType(dto: CreateReferenceTypeDto) {
    const existing = await this.prisma.expenseReferenceType.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException('A reference code with this value already exists');
    return this.prisma.expenseReferenceType.create({ data: dto });
  }

  async updateReferenceType(id: string, dto: Partial<CreateReferenceTypeDto>) {
    const existing = await this.prisma.expenseReferenceType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Reference type not found');
    return this.prisma.expenseReferenceType.update({ where: { id }, data: dto });
  }

  async removeReferenceType(id: string) {
    const inUse = await this.prisma.expense.count({ where: { referenceTypeId: id } });
    if (inUse > 0) return this.updateReferenceType(id, { isActive: false });
    await this.prisma.expenseReferenceType.delete({ where: { id } });
    return { success: true };
  }

  // --- Payment modes --------------------------------------------------------

  findAllPaymentModes(includeInactive = false) {
    return this.prisma.expensePaymentMode.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async createPaymentMode(dto: CreatePaymentModeDto) {
    const existing = await this.prisma.expensePaymentMode.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A payment mode with this name already exists');
    return this.prisma.expensePaymentMode.create({ data: dto });
  }

  async updatePaymentMode(id: string, dto: Partial<CreatePaymentModeDto>) {
    const existing = await this.prisma.expensePaymentMode.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Payment mode not found');
    return this.prisma.expensePaymentMode.update({ where: { id }, data: dto });
  }

  async removePaymentMode(id: string) {
    const inUse = await this.prisma.expense.count({ where: { paymentModeId: id } });
    if (inUse > 0) return this.updatePaymentMode(id, { isActive: false });
    await this.prisma.expensePaymentMode.delete({ where: { id } });
    return { success: true };
  }
}
