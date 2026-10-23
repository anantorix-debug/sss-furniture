// Shared Payment Ledger logic for the Party Orders shop page and the
// Purchasing > Supplier page. The Old Balance is kept in its own table,
// apart from current activity:
//   Old Balance table  - entries marked as old balance ("OLD BALANCE",
//                        "OPENING BALANCE", "B/F", "BROUGHT FORWARD"), and -
//                        when a From date is picked - everything before it,
//                        folded into one "Brought forward" row.
//   Current ledger     - newer orders/purchases and payments, with its own
//                        running balance starting from zero.
// Payments clear the old balance first (oldest first); the part of a
// payment that went to the old balance is shown on that payment's row and
// does not reduce the current balance.

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

export type OldRow<T> = { type: 'bf'; key: string; date: string; amount: number; count: number } | { type: 'entry'; key: string; entry: LedgerEntry<T> };

export interface CurrentRow<T> {
  key: string;
  entry: LedgerEntry<T>;
  towardsOld: number; // part of this payment that cleared old balance
  balance: number; // running current balance after this row
}

export interface LedgerResult<T> {
  oldRows: OldRow<T>[];
  oldTotal: number; // old balance before any new payment
  paidToOld: number;
  oldUnpaid: number;
  rows: CurrentRow<T>[];
  newDebits: number;
  paid: number; // every payment in the current period (incl. the part to old)
  currentBalance: number;
  total: number; // oldUnpaid + currentBalance
}

const day = (iso: string) => iso.slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;
const sorted = <T,>(list: LedgerEntry<T>[]) => [...list].sort((a, b) => day(a.date).localeCompare(day(b.date)) || (a.debit === b.debit ? 0 : a.debit ? -1 : 1));

export function buildLedger<T>(entries: LedgerEntry<T>[], range: { from?: string; to?: string } = {}): LedgerResult<T> {
  const { from, to } = range;
  const upToEnd = entries.filter((e) => !to || day(e.date) <= to);
  const isOld = (e: LedgerEntry<T>) => e.old || Boolean(from && day(e.date) < from);
  const signed = (e: LedgerEntry<T>) => (e.debit ? e.amount : -e.amount);

  // ---- Old Balance table
  const oldEntries = sorted(upToEnd.filter(isOld));
  const oldRows: OldRow<T>[] = [];
  const marked = oldEntries.filter((e) => e.old);
  const beforeFrom = oldEntries.filter((e) => !e.old);
  for (const e of marked) oldRows.push({ type: 'entry', key: e.key, entry: e });
  if (beforeFrom.length) {
    oldRows.push({ type: 'bf', key: 'bf', date: from!, amount: r2(beforeFrom.reduce((t, e) => t + signed(e), 0)), count: beforeFrom.length });
  }
  const oldTotal = r2(oldEntries.reduce((t, e) => t + signed(e), 0));

  // ---- Current ledger; payments clear the old balance first
  let oldLeft = Math.max(0, oldTotal);
  let running = 0;
  let newDebits = 0;
  let paid = 0;
  const rows: CurrentRow<T>[] = [];
  for (const e of sorted(upToEnd.filter((x) => !isOld(x)))) {
    let towardsOld = 0;
    if (e.debit) {
      newDebits += e.amount;
      running += e.amount;
    } else {
      paid += e.amount;
      towardsOld = Math.min(oldLeft, e.amount);
      oldLeft -= towardsOld;
      running -= e.amount - towardsOld;
    }
    rows.push({ key: e.key, entry: e, towardsOld: r2(towardsOld), balance: r2(running) });
  }
  const paidToOld = r2(Math.max(0, oldTotal) - oldLeft);
  const oldUnpaid = r2(oldTotal - paidToOld);
  return { oldRows, oldTotal, paidToOld, oldUnpaid, rows, newDebits: r2(newDebits), paid: r2(paid), currentBalance: r2(running), total: r2(oldUnpaid + running) };
}
