import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { CreateSupplierDto } from '../../suppliers/dto/create-supplier.dto';
import { CreateSupplierPaymentDto } from '../../suppliers/dto/create-supplier-payment.dto';
import { PurchasesService } from '../../orders/purchase/purchases.service';
import { CreatePurchaseDto } from '../../orders/purchase/dto/create-purchase.dto';
import { Role } from '../../../common/enums/role.enum';
import { TableSpec } from '../../../common/import/sheet-reader';
import { computeBoardFeet } from '../../../common/utils/board-feet.util';
import { blankToUndef, commitEach, commitGrouped, day, gridNum, GridRow, groupTotal, HandlerPreviewRow, ImportContext, ImportHandler, matchByName, normName, num, sheetDate, text, validOrThrow } from '../import-handler';

// Purchasing > Suppliers: the supplier list (name, phone, address).
@Injectable()
export class SuppliersImport implements ImportHandler {
  readonly kind = 'suppliers';
  readonly minRole = Role.ADMIN as const;
  readonly spec: TableSpec<string> = {
    aliases: { NAME: 'name', SUPPLIER: 'name', SUPPLIERNAME: 'name', VENDOR: 'name', PHONE: 'phone', MOBILE: 'phone', CONTACT: 'phone', PHONENO: 'phone', ADDRESS: 'address' },
    headerRequired: ['name'],
    dateColumn: 'name',
    label: 'NAME, PHONE, ADDRESS',
  };

  constructor(
    private prisma: PrismaService,
    private suppliers: SuppliersService,
  ) {}

  rowTotal() {
    return 0;
  }

  duplicateKey(row: GridRow) {
    return normName(row.name) || null;
  }

  async existingKeys() {
    return new Set((await this.prisma.supplier.findMany({ select: { name: true } })).map((s) => normName(s.name)));
  }

  async preview(rows: { line: number; cells: Partial<Record<string, string>> }[]): Promise<HandlerPreviewRow[]> {
    return rows.map(({ line, cells }) => ({ line, warnings: [], values: { name: text(cells, 'name'), phone: text(cells, 'phone'), address: text(cells, 'address') } }));
  }

  commit(items: GridRow[]) {
    return commitEach(items, async (r) => {
      const dto = await validOrThrow(CreateSupplierDto, { name: r.name.trim(), phone: blankToUndef(r.phone), address: blankToUndef(r.address) });
      await this.suppliers.create(dto);
    });
  }
}

// Purchasing > Purchase Orders: one sheet row per material line; lines with
// the same Purchase Ref (or, with none, the same supplier + date) become one
// purchase. Saved through PurchasesService.create - as a normal
// pending-approval purchase by default. Only when the Super Admin ticks
// "already received" is it recorded directly, which also books the stock.
@Injectable()
export class PurchasesImport implements ImportHandler {
  readonly kind = 'purchases';
  readonly minRole = Role.ADMIN as const;
  readonly spec: TableSpec<string> = {
    aliases: {
      PURCHASEREF: 'purchaseRef',
      REF: 'purchaseRef',
      PURCHASENO: 'purchaseRef',
      BILLNO: 'purchaseRef',
      INVOICE: 'purchaseRef',
      INVOICENO: 'purchaseRef',
      DATE: 'purchaseDate',
      PURCHASEDATE: 'purchaseDate',
      BILLDATE: 'purchaseDate',
      SUPPLIER: 'supplier',
      SUPPLIERNAME: 'supplier',
      VENDOR: 'supplier',
      PARTY: 'supplier',
      MATERIAL: 'material',
      MATERIALNAME: 'material',
      RAWMATERIAL: 'material',
      ITEM: 'material',
      PARTICULARS: 'material',
      QTY: 'quantity',
      QUANTITY: 'quantity',
      CFT: 'quantity',
      RATE: 'unitPrice',
      PRICE: 'unitPrice',
      UNITPRICE: 'unitPrice',
      THICKNESS: 'thicknessIn',
      THICKNESSIN: 'thicknessIn',
      WIDTH: 'widthIn',
      WIDTHIN: 'widthIn',
      LENGTH: 'lengthFt',
      LENGTHFT: 'lengthFt',
      PIECES: 'pieces',
      PCS: 'pieces',
      NOS: 'pieces',
      NOTE: 'notes',
      NOTES: 'notes',
      REMARKS: 'notes',
    },
    headerRequired: ['purchaseDate', 'supplier', 'material'],
    dateColumn: 'purchaseDate',
    label: 'PURCHASE REF, DATE, SUPPLIER, MATERIAL, QTY, RATE, THICKNESS, WIDTH, LENGTH, PIECES, NOTES',
  };

  constructor(
    private prisma: PrismaService,
    private purchases: PurchasesService,
  ) {}

  rowTotal(v: GridRow) {
    return (gridNum(v.quantity) ?? 0) * (gridNum(v.unitPrice) ?? 0);
  }

  groupKey(row: GridRow) {
    return (row.purchaseRef ?? '').trim().toUpperCase();
  }

  // A purchase = same supplier, same day, same total.
  duplicateKey(row: GridRow, all: GridRow[]) {
    if (!row.supplierId || !row.purchaseDate) return null;
    const total = groupTotal(row, all, (r) => this.groupKey(r), (r) => this.rowTotal(r));
    return `${row.supplierId}|${row.purchaseDate}|${total.toFixed(2)}`;
  }

  async existingKeys(rows: GridRow[]) {
    const supplierIds = [...new Set(rows.map((r) => r.supplierId).filter(Boolean))];
    const existing = await this.prisma.purchase.findMany({
      where: { supplierId: { in: supplierIds }, status: { not: 'CANCELLED' } },
      select: { supplierId: true, purchaseDate: true, items: { select: { quantity: true, unitPrice: true } } },
    });
    return new Set(
      existing.map((p) => `${p.supplierId}|${day(p.purchaseDate)}|${p.items.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0).toFixed(2)}`),
    );
  }

  async preview(rows: { line: number; cells: Partial<Record<string, string>> }[]): Promise<HandlerPreviewRow[]> {
    const [suppliers, materials] = await Promise.all([
      this.prisma.supplier.findMany({ select: { id: true, name: true } }),
      this.prisma.rawMaterial.findMany({ select: { id: true, name: true, measurementKind: true } }),
    ]);
    return rows.map(({ line, cells }) => {
      const warnings: string[] = [];
      const supplierName = text(cells, 'supplier');
      const supplierId = matchByName(suppliers, supplierName, 'Supplier', warnings, 'add the supplier first, then pick it here');
      const rawMaterialId = matchByName(materials, text(cells, 'material'), 'Material', warnings, 'add it under Inventory > Raw Materials, then pick it here');
      const purchaseDate = sheetDate(text(cells, 'purchaseDate'), 'Date', warnings);
      const dims = { thicknessIn: num(text(cells, 'thicknessIn')), widthIn: num(text(cells, 'widthIn')), lengthFt: num(text(cells, 'lengthFt')), pieces: num(text(cells, 'pieces')) };
      let quantity = num(text(cells, 'quantity'));
      // Board-feet timber: the quantity (CFT) is worked out from the sizes,
      // exactly as the server does when the purchase is saved.
      if (materials.find((m) => m.id === rawMaterialId)?.measurementKind === 'BOARD_FEET') {
        try {
          quantity = computeBoardFeet({ thicknessIn: dims.thicknessIn ?? undefined, widthIn: dims.widthIn ?? undefined, lengthFt: dims.lengthFt ?? undefined, pieces: dims.pieces ?? undefined });
        } catch {
          warnings.push('Board-feet material needs Thickness, Width, Length and Pieces');
        }
      } else if (quantity == null) {
        warnings.push('Qty is missing');
      }
      const price = num(text(cells, 'unitPrice'));
      if (price == null) warnings.push('Rate is missing');
      const s = (n: number | null) => (n != null ? String(n) : '');
      return {
        line,
        warnings,
        values: {
          purchaseRef: text(cells, 'purchaseRef') || `${suppliers.find((s) => s.id === supplierId)?.name ?? supplierName} ${purchaseDate}`.trim(),
          purchaseDate,
          supplierId,
          rawMaterialId,
          quantity: s(quantity),
          unitPrice: s(price),
          thicknessIn: s(dims.thicknessIn),
          widthIn: s(dims.widthIn),
          lengthFt: s(dims.lengthFt),
          pieces: s(dims.pieces),
          notes: text(cells, 'notes'),
        },
      };
    });
  }

  commit(items: GridRow[], ctx: ImportContext) {
    return commitGrouped(
      items,
      (r) => this.groupKey(r),
      async (lines) => {
        const head = lines[0];
        const dto = await validOrThrow(CreatePurchaseDto, {
          supplierId: head.supplierId,
          purchaseDate: head.purchaseDate,
          notes: blankToUndef(lines.map((l) => l.notes?.trim()).filter(Boolean).join('; ')),
          directRecord: ctx.options.directRecord === true ? true : undefined,
          items: lines.map((l) => ({
            rawMaterialId: l.rawMaterialId,
            quantity: gridNum(l.quantity) ?? 0,
            unitPrice: gridNum(l.unitPrice),
            thicknessIn: gridNum(l.thicknessIn),
            widthIn: gridNum(l.widthIn),
            lengthFt: gridNum(l.lengthFt),
            pieces: gridNum(l.pieces) != null ? Math.round(gridNum(l.pieces)!) : undefined,
          })),
        });
        await this.purchases.create(dto, ctx.userId, ctx.role);
      },
    );
  }
}

function supplierPayKey(supplierId: string, date: string, amount: number, voucherNo?: string | null, particulars?: string | null) {
  const v = normName(voucherNo);
  return v ? `${supplierId}|${date}|${amount.toFixed(2)}|V|${v}` : `${supplierId}|${date}|${amount.toFixed(2)}|P|${normName(particulars) || 'PAYMENT'}`;
}

// Purchasing > supplier page > Purchases (scoped to that one supplier)
@Injectable()
export class SupplierPurchasesImport implements ImportHandler {
  readonly kind = 'supplier-purchases';
  readonly minRole = Role.ADMIN as const;
  readonly requiredScope = ['supplierId'];
  readonly spec: TableSpec<string> = {
    aliases: {
      PURCHASEREF: 'purchaseRef',
      REF: 'purchaseRef',
      PURCHASENO: 'purchaseRef',
      BILLNO: 'purchaseRef',
      INVOICE: 'purchaseRef',
      INVOICENO: 'purchaseRef',
      DATE: 'purchaseDate',
      PURCHASEDATE: 'purchaseDate',
      BILLDATE: 'purchaseDate',
      MATERIAL: 'material',
      MATERIALNAME: 'material',
      RAWMATERIAL: 'material',
      ITEM: 'material',
      PARTICULARS: 'material',
      QTY: 'quantity',
      QUANTITY: 'quantity',
      CFT: 'quantity',
      RATE: 'unitPrice',
      PRICE: 'unitPrice',
      UNITPRICE: 'unitPrice',
      THICKNESS: 'thicknessIn',
      THICKNESSIN: 'thicknessIn',
      WIDTH: 'widthIn',
      WIDTHIN: 'widthIn',
      LENGTH: 'lengthFt',
      LENGTHFT: 'lengthFt',
      PIECES: 'pieces',
      PCS: 'pieces',
      NOS: 'pieces',
      NOTE: 'notes',
      NOTES: 'notes',
      REMARKS: 'notes',
    },
    headerRequired: ['purchaseDate', 'material'],
    dateColumn: 'purchaseDate',
    label: 'PURCHASE REF, DATE, MATERIAL, QTY, RATE, THICKNESS, WIDTH, LENGTH, PIECES, NOTES',
  };

  constructor(
    private prisma: PrismaService,
    private purchases: PurchasesService,
  ) {}

  rowTotal(v: GridRow) {
    return (gridNum(v.quantity) ?? 0) * (gridNum(v.unitPrice) ?? 0);
  }

  groupKey(row: GridRow) {
    return (row.purchaseRef ?? '').trim().toUpperCase();
  }

  duplicateKey(row: GridRow, all: GridRow[], ctx: ImportContext) {
    if (!row.purchaseDate) return null;
    const total = groupTotal(row, all, (r) => this.groupKey(r), (r) => this.rowTotal(r));
    return `${ctx.scope.supplierId}|${row.purchaseDate}|${total.toFixed(2)}`;
  }

  async existingKeys(_rows: GridRow[], ctx: ImportContext) {
    const existing = await this.prisma.purchase.findMany({
      where: { supplierId: ctx.scope.supplierId, status: { not: 'CANCELLED' } },
      select: { supplierId: true, purchaseDate: true, items: { select: { quantity: true, unitPrice: true } } },
    });
    return new Set(
      existing.map((p) => `${p.supplierId}|${day(p.purchaseDate)}|${p.items.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0).toFixed(2)}`),
    );
  }

  async preview(rows: { line: number; cells: Partial<Record<string, string>> }[], ctx: ImportContext): Promise<HandlerPreviewRow[]> {
    const materials = await this.prisma.rawMaterial.findMany({ select: { id: true, name: true, measurementKind: true } });
    const supplier = await this.prisma.supplier.findUnique({ where: { id: ctx.scope.supplierId }, select: { name: true } });
    const supplierName = supplier?.name ?? 'Supplier';

    return rows.map(({ line, cells }) => {
      const warnings: string[] = [];
      const rawMaterialId = matchByName(materials, text(cells, 'material'), 'Material', warnings, 'add it under Inventory > Raw Materials, then pick it here');
      const purchaseDate = sheetDate(text(cells, 'purchaseDate'), 'Date', warnings);
      const dims = { thicknessIn: num(text(cells, 'thicknessIn')), widthIn: num(text(cells, 'widthIn')), lengthFt: num(text(cells, 'lengthFt')), pieces: num(text(cells, 'pieces')) };
      let quantity = num(text(cells, 'quantity'));
      if (materials.find((m) => m.id === rawMaterialId)?.measurementKind === 'BOARD_FEET') {
        try {
          quantity = computeBoardFeet({ thicknessIn: dims.thicknessIn ?? undefined, widthIn: dims.widthIn ?? undefined, lengthFt: dims.lengthFt ?? undefined, pieces: dims.pieces ?? undefined });
        } catch {
          warnings.push('Board-feet material needs Thickness, Width, Length and Pieces');
        }
      } else if (quantity == null) {
        warnings.push('Qty is missing');
      }
      const price = num(text(cells, 'unitPrice'));
      if (price == null) warnings.push('Rate is missing');
      const s = (n: number | null) => (n != null ? String(n) : '');
      return {
        line,
        warnings,
        values: {
          purchaseRef: text(cells, 'purchaseRef') || `${supplierName} ${purchaseDate}`.trim(),
          purchaseDate,
          rawMaterialId,
          quantity: s(quantity),
          unitPrice: s(price),
          thicknessIn: s(dims.thicknessIn),
          widthIn: s(dims.widthIn),
          lengthFt: s(dims.lengthFt),
          pieces: s(dims.pieces),
          notes: text(cells, 'notes'),
        },
      };
    });
  }

  commit(items: GridRow[], ctx: ImportContext) {
    return commitGrouped(
      items,
      (r) => this.groupKey(r),
      async (lines) => {
        const head = lines[0];
        const dto = await validOrThrow(CreatePurchaseDto, {
          supplierId: ctx.scope.supplierId,
          purchaseDate: head.purchaseDate,
          notes: blankToUndef(lines.map((l) => l.notes?.trim()).filter(Boolean).join('; ')),
          directRecord: ctx.options.directRecord === true ? true : undefined,
          items: lines.map((l) => ({
            rawMaterialId: l.rawMaterialId,
            quantity: gridNum(l.quantity) ?? 0,
            unitPrice: gridNum(l.unitPrice),
            thicknessIn: gridNum(l.thicknessIn),
            widthIn: gridNum(l.widthIn),
            lengthFt: gridNum(l.lengthFt),
            pieces: gridNum(l.pieces) != null ? Math.round(gridNum(l.pieces)!) : undefined,
          })),
        });
        await this.purchases.create(dto, ctx.userId, ctx.role);
      },
    );
  }
}

// Purchasing > supplier page > Payment Ledger (scoped to that one supplier)
@Injectable()
export class SupplierPaymentsImport implements ImportHandler {
  readonly kind = 'supplier-payments';
  readonly minRole = Role.ADMIN as const;
  readonly requiredScope = ['supplierId'];
  readonly spec: TableSpec<string> = {
    aliases: {
      DATE: 'date',
      PAYMENTDATE: 'date',
      VOUCHERNO: 'voucherNo',
      VOUCHER: 'voucherNo',
      VOUCHERNUMBER: 'voucherNo',
      VNO: 'voucherNo',
      REFERENCE: 'voucherNo',
      REF: 'voucherNo',
      REFNO: 'voucherNo',
      AMOUNT: 'amount',
      TOTAL: 'amount',
      PAID: 'amount',
      PAYMENT: 'amount',
      MODE: 'mode',
      PAYMENTMODE: 'mode',
      PARTICULARS: 'particulars',
      NOTE: 'particulars',
      NOTES: 'particulars',
      REMARK: 'particulars',
      REMARKS: 'particulars',
      DESCRIPTION: 'particulars',
    },
    headerRequired: ['date', 'amount'],
    dateColumn: 'date',
    label: 'DATE, VOUCHER NO, AMOUNT, MODE, PARTICULARS',
  };

  constructor(
    private prisma: PrismaService,
    private suppliers: SuppliersService,
  ) {}

  rowTotal(v: GridRow) {
    return gridNum(v.amount) ?? 0;
  }

  duplicateKey(row: GridRow, _all: GridRow[], ctx: ImportContext) {
    const amount = gridNum(row.amount);
    if (!row.date || amount == null) return null;
    return supplierPayKey(ctx.scope.supplierId, row.date, amount, row.voucherNo, row.particulars);
  }

  async existingKeys(_rows: GridRow[], ctx: ImportContext) {
    const payments = await this.prisma.supplierPayment.findMany({
      where: { supplierId: ctx.scope.supplierId },
      select: { date: true, amount: true, voucherNo: true, particulars: true },
    });
    return new Set(payments.map((p) => supplierPayKey(ctx.scope.supplierId, day(p.date), Number(p.amount), p.voucherNo, p.particulars)));
  }

  async preview(rows: { line: number; cells: Partial<Record<string, string>> }[]): Promise<HandlerPreviewRow[]> {
    return rows.map(({ line, cells }) => {
      const warnings: string[] = [];
      const amount = num(text(cells, 'amount'));
      if (amount == null || amount <= 0) warnings.push(`Amount "${text(cells, 'amount')}" is missing or not a number`);
      return {
        line,
        warnings,
        values: {
          date: sheetDate(text(cells, 'date'), 'Date', warnings),
          voucherNo: text(cells, 'voucherNo').replace(/^-+$/, ''),
          amount: amount != null && amount > 0 ? String(amount) : '',
          mode: text(cells, 'mode').toUpperCase() || 'CASH',
          particulars: text(cells, 'particulars'),
        },
      };
    });
  }

  commit(items: GridRow[], ctx: ImportContext) {
    return commitEach(items, async (r) => {
      const dto = await validOrThrow(CreateSupplierPaymentDto, {
        date: r.date,
        amount: gridNum(r.amount),
        voucherNo: blankToUndef(r.voucherNo),
        particulars: blankToUndef(r.particulars),
        mode: blankToUndef(r.mode?.toUpperCase() || 'CASH'),
      });
      await this.suppliers.addPayment(ctx.scope.supplierId, dto, ctx.userId);
    });
  }
}

