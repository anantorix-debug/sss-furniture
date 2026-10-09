import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerOrdersService } from '../../orders/customer/customer-orders.service';
import { PartyOrdersService } from '../../orders/party/party-orders.service';
import { CreatePaymentDto } from '../../orders/customer/dto/create-payment.dto';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { CreateSupplierPaymentDto } from '../../suppliers/dto/create-supplier-payment.dto';
import { CarpenterService } from '../../carpenter/carpenter.service';
import { CreateCarpenterPaymentDto } from '../../carpenter/dto/create-carpenter-payment.dto';
import { paymentTypeOf } from '../../carpenter/work-import.parser';
import { Role } from '../../../common/enums/role.enum';
import { TableSpec } from '../../../common/import/sheet-reader';
import { blankToUndef, commitEach, day, gridNum, GridRow, HandlerPreviewRow, ImportHandler, ImportContext, normName, num, sheetDate, text, validOrThrow } from '../import-handler';

type Source = 'CUSTOMER_ORDER' | 'PARTY_ORDER' | 'SUPPLIER' | 'CARPENTER';

function sourceOf(raw: string): Source | null {
  const t = normName(raw);
  if (!t) return null;
  if (t.startsWith('CUST')) return 'CUSTOMER_ORDER';
  if (t.startsWith('PARTY') || t.startsWith('SHOP')) return 'PARTY_ORDER';
  if (t.startsWith('SUPP') || t.startsWith('VENDOR')) return 'SUPPLIER';
  if (t.startsWith('CARP') || t.startsWith('WORKER') || t.startsWith('EMPLOY') || t.startsWith('SALARY')) return 'CARPENTER';
  return null;
}

// Customer/Party order payment types (the order services auto-pick one when
// it's left blank).
function orderPaymentType(raw: string): string {
  const t = normName(raw);
  if (t.startsWith('ADV')) return 'ADVANCE';
  if (t.startsWith('PART')) return 'PARTIAL';
  if (t.startsWith('BAL')) return 'BALANCE';
  if (t === 'FULL' || t.startsWith('FULLPAY')) return 'FULL';
  return '';
}

// Payments page: money received from customers and parties, and paid to
// suppliers and workers, in one sheet. Each row names who it's for in
// "Reference": Customer Order -> Order ID (SSS-123), Party Order -> Job No,
// Supplier -> supplier name, Worker -> worker name. Saved through each
// page's own add-payment logic (so order payments still auto-pick a type
// and auto-mark delivery when fully paid). Expenses have their own upload
// on the Expenses page.
@Injectable()
export class PaymentsImport implements ImportHandler {
  readonly kind = 'payments';
  readonly minRole = Role.SUPERADMIN as const;
  readonly spec: TableSpec<string> = {
    aliases: {
      SOURCE: 'source',
      FROMTO: 'source',
      CATEGORY: 'source',
      REFERENCE: 'reference',
      ORDERID: 'reference',
      ORDERNO: 'reference',
      JOBNO: 'reference',
      NAME: 'reference',
      PARTYNAME: 'reference',
      PAIDTO: 'reference',
      RECEIVEDFROM: 'reference',
      DATE: 'date',
      PAYMENTDATE: 'date',
      AMOUNT: 'amount',
      TYPE: 'type',
      PAYMENTTYPE: 'type',
      MODE: 'mode',
      PAYMENTMODE: 'mode',
      VOUCHERNO: 'voucherNo',
      VOUCHER: 'voucherNo',
      REFNO: 'voucherNo',
      NOTE: 'note',
      NOTES: 'note',
      REMARKS: 'note',
      PARTICULARS: 'note',
    },
    headerRequired: ['date', 'amount', 'reference'],
    dateColumn: 'date',
    label: 'SOURCE, REFERENCE, DATE, AMOUNT, TYPE, MODE, VOUCHER NO, NOTE',
  };

  constructor(
    private prisma: PrismaService,
    private customerOrders: CustomerOrdersService,
    private partyOrders: PartyOrdersService,
    private suppliers: SuppliersService,
    private carpenter: CarpenterService,
  ) {}

  rowTotal(v: GridRow) {
    return gridNum(v.amount) ?? 0;
  }

  // Reference text -> record id, per source. One query per source per call.
  private async resolver(rows: GridRow[]) {
    const refs = (s: Source) => [...new Set(rows.filter((r) => r.source === s).map((r) => r.reference?.trim()).filter(Boolean))];
    const [customer, party, suppliers, workers] = await Promise.all([
      this.prisma.customerOrder.findMany({ where: { orderId: { in: refs('CUSTOMER_ORDER') } }, select: { id: true, orderId: true } }),
      this.prisma.partyOrder.findMany({ where: { jobNumber: { in: refs('PARTY_ORDER') } }, select: { id: true, jobNumber: true } }),
      this.prisma.supplier.findMany({ select: { id: true, name: true } }),
      this.prisma.carpenter.findMany({ select: { id: true, name: true } }),
    ]);
    return (source: string, reference: string): string | null => {
      const ref = normName(reference);
      if (!ref) return null;
      if (source === 'CUSTOMER_ORDER') return customer.find((o) => normName(o.orderId) === ref)?.id ?? null;
      if (source === 'PARTY_ORDER') return party.find((o) => normName(o.jobNumber) === ref)?.id ?? null;
      if (source === 'SUPPLIER') return suppliers.find((s) => normName(s.name) === ref)?.id ?? null;
      if (source === 'CARPENTER') return workers.find((w) => normName(w.name) === ref)?.id ?? null;
      return null;
    };
  }

  // Same target (order / supplier / worker), same day, same amount.
  duplicateKey(row: GridRow) {
    const amount = gridNum(row.amount);
    if (!row.source || !row.reference || !row.date || amount == null) return null;
    return `${row.source}|${normName(row.reference)}|${row.date}|${amount.toFixed(2)}`;
  }

  async existingKeys(rows: GridRow[]) {
    const resolve = await this.resolver(rows);
    const keys = new Set<string>();
    const byTarget = new Map<string, { source: string; reference: string }>();
    for (const r of rows) {
      const id = resolve(r.source, r.reference);
      if (id) byTarget.set(`${r.source}|${id}`, { source: r.source, reference: r.reference });
    }
    const ids = (s: string) => [...byTarget.keys()].filter((k) => k.startsWith(`${s}|`)).map((k) => k.split('|')[1]);
    const add = (source: string, id: string, date: Date, amount: unknown) => {
      const ref = byTarget.get(`${source}|${id}`)?.reference;
      if (ref) keys.add(`${source}|${normName(ref)}|${day(date)}|${Number(amount).toFixed(2)}`);
    };
    const [c, p, s, w] = await Promise.all([
      this.prisma.customerOrderPayment.findMany({ where: { orderId: { in: ids('CUSTOMER_ORDER') } }, select: { orderId: true, date: true, amount: true } }),
      this.prisma.partyOrderPayment.findMany({ where: { orderId: { in: ids('PARTY_ORDER') } }, select: { orderId: true, date: true, amount: true } }),
      this.prisma.supplierPayment.findMany({ where: { supplierId: { in: ids('SUPPLIER') } }, select: { supplierId: true, date: true, amount: true } }),
      this.prisma.carpenterPayment.findMany({ where: { carpenterId: { in: ids('CARPENTER') } }, select: { carpenterId: true, date: true, amount: true } }),
    ]);
    c.forEach((x) => add('CUSTOMER_ORDER', x.orderId, x.date, x.amount));
    p.forEach((x) => add('PARTY_ORDER', x.orderId, x.date, x.amount));
    s.forEach((x) => add('SUPPLIER', x.supplierId, x.date, x.amount));
    w.forEach((x) => add('CARPENTER', x.carpenterId, x.date, x.amount));
    return keys;
  }

  async preview(rows: { line: number; cells: Partial<Record<string, string>> }[]): Promise<HandlerPreviewRow[]> {
    const draft = rows.map(({ line, cells }) => {
      const warnings: string[] = [];
      const source = sourceOf(text(cells, 'source'));
      if (!source) warnings.push(text(cells, 'source') ? `Source "${text(cells, 'source')}" not recognised - pick one` : 'Source is missing - pick one');
      const amount = num(text(cells, 'amount'));
      if (amount == null || amount <= 0) warnings.push(`Amount "${text(cells, 'amount')}" is missing or not a number`);
      return {
        line,
        warnings,
        values: {
          source: source ?? '',
          reference: text(cells, 'reference'),
          date: sheetDate(text(cells, 'date'), 'Date', warnings),
          amount: amount != null && amount > 0 ? String(amount) : '',
          type: text(cells, 'type'),
          mode: text(cells, 'mode').toUpperCase() || 'CASH',
          voucherNo: text(cells, 'voucherNo'),
          note: text(cells, 'note'),
        },
      };
    });
    const resolve = await this.resolver(draft.map((d) => d.values));
    for (const d of draft) {
      if (d.values.source && d.values.reference && !resolve(d.values.source, d.values.reference)) {
        d.warnings.push(`${REF_HINT[d.values.source as Source]} "${d.values.reference}" not found`);
      }
    }
    return draft;
  }

  async commit(items: GridRow[], ctx: ImportContext) {
    const resolve = await this.resolver(items);
    return commitEach(items, async (r) => {
      const id = resolve(r.source, r.reference);
      if (!id) throw new BadRequestException(`${REF_HINT[r.source as Source] ?? 'Reference'} "${r.reference}" not found`);
      const amount = gridNum(r.amount);
      if (r.source === 'CUSTOMER_ORDER' || r.source === 'PARTY_ORDER') {
        const dto = await validOrThrow(CreatePaymentDto, {
          date: r.date,
          amount,
          type: orderPaymentType(r.type) || undefined,
          mode: blankToUndef(r.mode?.toUpperCase()),
          note: blankToUndef([r.voucherNo?.trim() && `Voucher ${r.voucherNo.trim()}`, r.note?.trim()].filter(Boolean).join(' - ')),
        });
        if (r.source === 'CUSTOMER_ORDER') await this.customerOrders.addPayment(id, dto, ctx.userId);
        else await this.partyOrders.addPayment(id, dto, ctx.userId);
      } else if (r.source === 'SUPPLIER') {
        const dto = await validOrThrow(CreateSupplierPaymentDto, { date: r.date, amount, mode: blankToUndef(r.mode?.toUpperCase()), voucherNo: blankToUndef(r.voucherNo), particulars: blankToUndef(r.note) });
        await this.suppliers.addPayment(id, dto, ctx.userId);
      } else {
        const dto = await validOrThrow(CreateCarpenterPaymentDto, {
          date: r.date,
          amount,
          paymentType: paymentTypeOf(r.type) ?? 'OTHER',
          reference: blankToUndef(r.voucherNo),
          mode: blankToUndef(r.mode?.toUpperCase()),
          note: blankToUndef(r.note),
        });
        await this.carpenter.addPayment(id, dto, ctx.userId);
      }
    });
  }
}

const REF_HINT: Record<Source, string> = {
  CUSTOMER_ORDER: 'Customer Order ID',
  PARTY_ORDER: 'Party Order Job No',
  SUPPLIER: 'Supplier',
  CARPENTER: 'Worker',
};
