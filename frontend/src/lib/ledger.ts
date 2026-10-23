// Shared Payment Ledger logic for the Party Orders shop page and the
// Purchasing > Supplier page: an Old Balance (brought forward) kept apart
// from current activity, and the four summary boxes.
//
// An entry counts as Old Balance when its text says so ("OLD BALANCE",
// "OPENING BALANCE", "B/F", "BROUGHT FORWARD"). When a From date is picked,
// everything before it is also folded into one "Old Balance (b/f)" row, so
// the running balance always starts from what was really owed then.

const OLD_BALANCE_RE = /\b(OLD\s*BAL(ANCE)?|OPENING\s*BAL(ANCE)?|BROUGHT\s*FORWARD|B\s*\/\s*F)\b/i;

export function isOldBalance(text: string | null | undefined): boolean {
  return OLD_BALANCE_RE.test(text ?? '');
}

export interface LedgerEntry<T> {
  key: string;
  date: string; // ISO
  amount: number;
  debit: boolean; // order / purchase (adds to what is owed)
  old: boolean; // an Old Balance entry
  data: T;
}

export type LedgerRow<T> =
  | { type: 'bf'; key: string; date: string; amount: number; balance: number; count: number }
  | { type: 'entry'; key: string; entry: LedgerEntry<T>; balance: number };

export interface LedgerResult<T> {
  rows: LedgerRow<T>[];
  oldBalance: number;
  newDebits: number;
  paid: number;
  current: number;
}

const day = (iso: string) => iso.slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildLedger<T>(entries: LedgerEntry<T>[], range: { from?: string; to?: string } = {}): LedgerResult<T> {
  const { from, to } = range;
  const upToEnd = entries.filter((e) => !to || day(e.date) <= to);
  const sorted = (list: LedgerEntry<T>[]) =>
    [...list].sort((a, b) => day(a.date).localeCompare(day(b.date)) || (a.debit === b.debit ? 0 : a.debit ? -1 : 1));

  const rows: LedgerRow<T>[] = [];
  let running = 0;
  let oldBalance = 0;

  let current: LedgerEntry<T>[];
  if (from) {
    // Old Balance entries + everything before From -> one brought-forward row.
    const carried = upToEnd.filter((e) => e.old || day(e.date) < from);
    oldBalance = r2(carried.reduce((t, e) => t + (e.debit ? e.amount : -e.amount), 0));
    if (carried.length) {
      running = oldBalance;
      rows.push({ type: 'bf', key: 'bf', date: from, amount: oldBalance, balance: running, count: carried.length });
    }
    current = upToEnd.filter((e) => !e.old && day(e.date) >= from);
  } else {
    // Old Balance entries first, each on its own row.
    for (const e of sorted(upToEnd.filter((x) => x.old))) {
      const signed = e.debit ? e.amount : -e.amount;
      oldBalance += signed;
      running += signed;
      rows.push({ type: 'entry', key: e.key, entry: e, balance: r2(running) });
    }
    oldBalance = r2(oldBalance);
    current = upToEnd.filter((x) => !x.old);
  }

  let newDebits = 0;
  let paid = 0;
  for (const e of sorted(current)) {
    if (e.debit) newDebits += e.amount;
    else paid += e.amount;
    running += e.debit ? e.amount : -e.amount;
    rows.push({ type: 'entry', key: e.key, entry: e, balance: r2(running) });
  }
  return { rows, oldBalance, newDebits: r2(newDebits), paid: r2(paid), current: r2(oldBalance + newDebits - paid) };
}
