import { computeBalance, sumAmounts } from './balance.util';

describe('balance.util', () => {
  describe('sumAmounts', () => {
    it('sums numeric amounts', () => {
      expect(sumAmounts([{ amount: 100 }, { amount: 50 }])).toBe(150);
    });

    it('sums string amounts (as returned by some ORMs)', () => {
      expect(sumAmounts([{ amount: '100.50' }, { amount: '49.50' }])).toBe(150);
    });

    it('sums Prisma Decimal-like objects', () => {
      const decimalLike = { toNumber: () => 25.5 };
      expect(sumAmounts([{ amount: decimalLike }])).toBe(25.5);
    });

    it('returns 0 for an empty list', () => {
      expect(sumAmounts([])).toBe(0);
    });
  });

  describe('computeBalance', () => {
    it('computes remaining balance after partial payment', () => {
      const result = computeBalance(23000, [{ amount: 10000 }, { amount: 13000 }]);
      expect(result.totalReceived).toBe(23000);
      expect(result.balanceAmount).toBe(0);
    });

    it('computes a positive outstanding balance when underpaid', () => {
      const result = computeBalance(324000, [{ amount: 100000 }, { amount: 100000 }]);
      expect(result.totalReceived).toBe(200000);
      expect(result.balanceAmount).toBe(124000);
    });

    it('computes a negative balance when overpaid (never silently clamps)', () => {
      const result = computeBalance(1000, [{ amount: 1500 }]);
      expect(result.balanceAmount).toBe(-500);
    });

    it('handles floating point amounts without drift', () => {
      const result = computeBalance(10, [{ amount: 3.1 }, { amount: 3.1 }, { amount: 3.1 }]);
      expect(result.balanceAmount).toBe(0.7);
    });

    it('returns the full total as balance when there are no payments yet', () => {
      const result = computeBalance(5000, []);
      expect(result.totalReceived).toBe(0);
      expect(result.balanceAmount).toBe(5000);
    });
  });
});
