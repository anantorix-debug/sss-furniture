import { formatCurrency } from '@/lib/format';

// The four boxes above a Payment Ledger: Old Balance, New Orders /
// Purchases, Paid, Current Balance (= old + new - paid).
export function LedgerSummary({ oldBalance, newDebits, paid, current, newLabel, fromDate }: { oldBalance: number; newDebits: number; paid: number; current: number; newLabel: string; fromDate?: string }) {
  const box = (label: string, value: number, sub: string, tone = 'text-ink') => (
    <div className="rounded-lg border border-brand-100 bg-white px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`text-base font-bold ${tone}`}>{formatCurrency(value)}</p>
      <p className="text-[10.5px] text-ink-muted leading-tight">{sub}</p>
    </div>
  );
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
      {box('Old Balance', oldBalance, fromDate ? 'Brought forward to the From date' : 'Opening / old balance entries')}
      {box(newLabel, newDebits, fromDate ? 'In the selected dates' : 'After the old balance')}
      {box('Paid', paid, fromDate ? 'In the selected dates' : 'All payments', 'text-emerald-700')}
      {box('Current Balance', current, 'Old + new − paid', current > 0 ? 'text-red-700' : 'text-emerald-700')}
    </div>
  );
}
