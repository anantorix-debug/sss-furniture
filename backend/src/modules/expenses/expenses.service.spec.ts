import { ExpensesService } from './expenses.service';

function searchFor(search?: string) {
  const service = new ExpensesService({} as any) as any;
  return service.buildWhere({ search }).OR;
}

describe('ExpensesService search', () => {
  it('does not filter when the box is empty or only spaces', () => {
    expect(searchFor(undefined)).toBeUndefined();
    expect(searchFor('   ')).toBeUndefined();
  });

  it('finds a voucher number, and the same number as an amount', () => {
    const or = searchFor('845');
    expect(or).toContainEqual({ voucherNumber: 845 });
    expect(or).toContainEqual({ amount: 845 });
  });

  it('treats V845 as a voucher only', () => {
    for (const q of ['V845', 'v845', 'V 845', 'V-845', 'V.845']) {
      const or = searchFor(q);
      expect(or).toContainEqual({ voucherNumber: 845 });
      expect(or).not.toContainEqual({ amount: 845 });
    }
  });

  it('accepts amounts written with commas or a rupee sign', () => {
    for (const q of ['2,500', '₹2,500', '₹ 2500']) expect(searchFor(q)).toContainEqual({ amount: 2500 });
    expect(searchFor('2500.50')).toContainEqual({ amount: 2500.5 });
    expect(searchFor('2500.50')).not.toContainEqual({ voucherNumber: 2500.5 });
  });

  it('searches text and payment mode, with spaces trimmed', () => {
    const or = searchFor('  IOB ');
    expect(or).toContainEqual({ particulars: { contains: 'IOB' } });
    expect(or).toContainEqual({ paymentMode: { name: { contains: 'IOB' } } });
    expect(or).toContainEqual({ referenceType: { code: { contains: 'IOB' } } });
  });

  it('does not treat words as numbers', () => {
    const or = searchFor('SWIFT DIESEL');
    expect(or.some((c: object) => 'voucherNumber' in c || 'amount' in c)).toBe(false);
    expect(searchFor('TN77K9984').some((c: object) => 'voucherNumber' in c || 'amount' in c)).toBe(false);
  });

  it('ignores numbers too large for the voucher column instead of failing', () => {
    expect(searchFor('99999999999').some((c: object) => 'voucherNumber' in c)).toBe(false);
    expect(searchFor('V99999999999').some((c: object) => 'voucherNumber' in c)).toBe(false);
  });
});
