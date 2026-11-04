import { SearchService } from './search.service';

// Runs a tiny subset of Prisma's filters over in-memory rows, enough to prove
// which sections each search box fills.
function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]: [string, any]) => {
    if (key === 'OR') return cond.some((c: any) => matchesWhere(row, c));
    if (cond && typeof cond === 'object' && 'in' in cond) return cond.in.includes(row[key]);
    if (cond && typeof cond === 'object' && 'contains' in cond) return String(row[key] ?? '').toLowerCase().includes(String(cond.contains).toLowerCase());
    if (cond && typeof cond === 'object') return matchesWhere(row[key] ?? {}, cond.is ?? cond);
    return row[key] === cond;
  });
}
const table = (rows: any[]) => ({
  findMany: async ({ where }: any) => rows.filter((r) => matchesWhere(r, where)),
  findFirst: async ({ where }: any) => rows.find((r) => matchesWhere(r, where)) ?? null,
});

const order = (o: object) => ({ orderValue: 100, totalAmount: 100, payments: [], ...o });
const db = {
  product: table([
    { id: 'p999', modelNo: '999', name: 'HEAM-ROUND', retailPrice: 0 },
    { id: 'p1999', modelNo: '1999', name: 'OTHER', retailPrice: 0 },
    { id: 'pPO', modelNo: 'PO-NEW-2', name: 'TEXT MODEL', retailPrice: 0 },
  ]),
  customerOrder: table([
    order({ id: 'co999', cotTrack: 'JOB-1, 999', orderId: 'SSS-1', jobNumber: 'JOB-1' }),
    order({ id: 'coOrderId', cotTrack: '5', orderId: 'SSS-999', jobNumber: 'JOB-2026-00999' }),
    order({ id: 'coLong', cotTrack: '1999', orderId: 'SSS-2', jobNumber: 'JOB-2' }),
  ]),
  customerOrderItem: table([]),
  partyOrder: table([]),
  partyOrderItem: table([
    { id: 'pi999', orderId: 'x', modelNo: '999', order: order({ shopName: 'A' }) },
    { id: 'pi1999', orderId: 'y', modelNo: '1999', order: order({ shopName: 'B' }) },
  ]),
  expense: table([
    { id: 'e999', voucherNumber: 999, status: 'ACTIVE', particulars: 'ANUJ', amount: 1000, date: new Date(), category: { name: 'Salary' }, paymentMode: { name: 'IOB' }, createdBy: { name: 'a' } },
    { id: 'eName', voucherNumber: 5, status: 'ACTIVE', particulars: 'VOUCHER 999 NOTE', amount: 999, date: new Date(), category: { name: 'Salary' }, paymentMode: { name: 'IOB' }, createdBy: { name: 'a' } },
    { id: 'eArchived', voucherNumber: 998, status: 'ARCHIVED', particulars: 'OLD', amount: 1, date: new Date(), category: { name: 'Salary' }, paymentMode: { name: 'IOB' }, createdBy: { name: 'a' } },
  ]),
  carpenterPayment: table([
    { id: 'c999', reference: 'SSS-999', amount: 1, date: new Date(), carpenter: { name: 'RAM' } },
    { id: 'c1999', reference: '1999', amount: 1, date: new Date(), carpenter: { name: 'RAM' } },
  ]),
  purchase: table([]),
  investorTransaction: table([]),
  supplierPayment: table([
    { id: 's999', voucherNo: '999', amount: 1, date: new Date(), supplier: { name: 'DEVI' } },
    { id: 's9990', voucherNo: '9990', amount: 1, date: new Date(), supplier: { name: 'DEVI' } },
  ]),
  carpenterWorkItem: table([
    { id: 'w999', modelNo: '999', sourceCustomerOrderId: null, sourcePartyOrderItemId: null, stockMovements: [], price: 0, extra: 0, total: 0 },
    { id: 'w1999', modelNo: '1999', sourceCustomerOrderId: null, sourcePartyOrderItemId: null, stockMovements: [], price: 0, extra: 0, total: 0 },
    { id: 'wLinked', modelNo: 'JOB-1', sourceCustomerOrderId: 'co999', sourcePartyOrderItemId: null, stockMovements: [], price: 0, extra: 0, total: 0 },
  ]),
  stockMovement: table([]),
};
const service = new SearchService(db as any, {} as any);
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('SearchService.track', () => {
  describe('Voucher box', () => {
    it('shows only records with that voucher number, nothing about the model', async () => {
      const r = await service.track('999', undefined, 'voucher');
      expect(ids(r.expenses)).toEqual(['e999']);
      expect(ids(r.carpenterPayments)).toEqual(['c999']);
      expect(ids(r.supplierPayments)).toEqual(['s999']);
      expect(r.product).toBeNull();
      expect(r.customerOrders).toEqual([]);
      expect(r.partyOrderItems).toEqual([]);
      expect(r.workItems).toEqual([]);
      expect(r.found).toBe(true);
    });

    it('accepts V999 the same as 999', async () => {
      const r = await service.track('V999', undefined, 'voucher');
      expect(ids(r.expenses)).toEqual(['e999']);
      expect(ids(r.supplierPayments)).toEqual(['s999']);
    });

    it('does not match a number inside names or amounts', async () => {
      const r = await service.track('999', undefined, 'voucher');
      expect(ids(r.expenses)).not.toContain('eName');
    });

    it('leaves out archived expenses', async () => {
      const r = await service.track('998', undefined, 'voucher');
      expect(r.expenses).toEqual([]);
      expect(r.found).toBe(false);
    });

    it('does not fail on a number too large for a voucher', async () => {
      const r = await service.track('99999999999', undefined, 'voucher');
      expect(r.found).toBe(false);
    });

    it('finds a typed reference by part of its text', async () => {
      const r = await service.track('SSS-99', undefined, 'voucher');
      expect(ids(r.carpenterPayments)).toEqual(['c999']);
    });
  });

  describe('Model No box', () => {
    it('shows only product, order and production data, no vouchers', async () => {
      const r = await service.track('999', undefined, 'model');
      expect(r.product?.id).toBe('p999');
      expect(ids(r.partyOrderItems)).toEqual(['pi999']);
      expect(r.expenses).toEqual([]);
      expect(r.carpenterPayments).toEqual([]);
      expect(r.supplierPayments).toEqual([]);
      expect(r.purchaseOrders).toEqual([]);
      expect(r.investorTransactions).toEqual([]);
    });

    it('matches a whole number only: 999 is not 1999 or an Order ID ending in 999', async () => {
      const r = await service.track('999', undefined, 'model');
      expect(ids(r.customerOrders)).toEqual(['co999']);
      expect(ids(r.workItems).sort()).toEqual(['w999', 'wLinked']);
    });

    it('finds a number inside a combined Model No, with that order\'s production', async () => {
      const r = await service.track('999', undefined, 'model');
      expect(ids(r.customerOrders)).toContain('co999');
      expect(ids(r.workItems)).toContain('wLinked');
    });

    it('still finds text Model Nos by part of the text', async () => {
      const r = await service.track('PO-NEW', undefined, 'model');
      expect(r.product?.id).toBe('pPO');
    });

    it('still finds an order by Order ID or Job No when typed in full', async () => {
      expect(ids((await service.track('SSS-999', undefined, 'model')).customerOrders)).toEqual(['coOrderId']);
      expect(ids((await service.track('JOB-2026-00999', undefined, 'model')).customerOrders)).toEqual(['coOrderId']);
    });

    it('is the default when no box is named', async () => {
      const r = await service.track('999');
      expect(r.product?.id).toBe('p999');
      expect(r.expenses).toEqual([]);
    });
  });
});
