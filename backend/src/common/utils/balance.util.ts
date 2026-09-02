export interface AmountLike {
  amount: number | string | { toNumber?: () => number };
}

function toNumber(value: number | string | { toNumber?: () => number }): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseFloat(value);
  if (value && typeof value.toNumber === 'function') return value.toNumber();
  return Number(value);
}

export function sumAmounts(items: AmountLike[]): number {
  return items.reduce((sum, item) => sum + toNumber(item.amount), 0);
}

export function computeBalance(total: number | string, payments: AmountLike[]) {
  const totalReceived = sumAmounts(payments);
  const totalNum = toNumber(total as any);
  return {
    totalReceived,
    balanceAmount: Math.round((totalNum - totalReceived) * 100) / 100,
  };
}

export type SuggestedPaymentType = 'ADVANCE' | 'PARTIAL' | 'BALANCE' | 'FULL';

// Auto-labels a payment the same way the original tracking sheet reads:
// the first payment against an order is the Advance, a payment that clears
// the balance is the Balance (or Full, if it's also the first and only
// one), anything else in between is Partial. Always overridable by an
// explicit `type` on the request - this is only the default.
export function suggestPaymentType(orderValue: number, existingPayments: AmountLike[], newAmount: number): SuggestedPaymentType {
  const existingPaid = sumAmounts(existingPayments);
  const isFirst = existingPayments.length === 0;
  const totalAfter = existingPaid + newAmount;
  const willClearBalance = totalAfter >= orderValue - 0.01; // tolerate rounding

  if (willClearBalance) return isFirst ? 'FULL' : 'BALANCE';
  return isFirst ? 'ADVANCE' : 'PARTIAL';
}
