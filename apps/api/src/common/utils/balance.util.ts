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
