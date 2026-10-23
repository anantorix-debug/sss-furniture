import { formatCurrency, formatDate } from '@/lib/format';
import type { OldPayment, OldRow } from '@/lib/ledger';

// The four boxes above a Payment Ledger.
export function LedgerSummary({ oldUnpaid, oldTotal, paidToOld, currentBalance, paid }: { oldUnpaid: number; oldTotal: number; paidToOld: number; currentBalance: number; paid: number }) {
  const total = oldUnpaid + currentBalance;
  const box = (label: string, value: number, sub: string, tone = 'text-ink') => (
    <div className="rounded-lg border border-brand-100 bg-white px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`text-base font-bold ${tone}`}>{formatCurrency(value)}</p>
      <p className="text-[10.5px] text-ink-muted leading-tight">{sub}</p>
    </div>
  );
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
      {box('Old Balance', oldUnpaid, oldTotal ? `${formatCurrency(oldTotal)} − ${formatCurrency(paidToOld)} paid` : 'No old balance', oldUnpaid > 0 ? 'text-red-700' : 'text-ink')}
      {box('Current Balance', currentBalance, 'Orders − payments', currentBalance > 0 ? 'text-red-700' : 'text-emerald-700')}
      {box('Paid', paid, 'Payments in this view', 'text-emerald-700')}
      {box('Total Balance', total, `Old ${formatCurrency(oldUnpaid)} + Current ${formatCurrency(currentBalance)}`, total > 0 ? 'text-red-700' : 'text-emerald-700')}
    </div>
  );
}

// The separate Old Balance table: the old entries (or "Brought forward"
// when a From date is set), what payments cleared of it, and what's left.
export function OldBalanceTable<T>({
  rows,
  payments,
  oldUnpaid,
  describe,
}: {
  rows: OldRow<T>[];
  payments: OldPayment<T>[];
  oldUnpaid: number;
  describe: (data: T) => { label: string; ref: React.ReactNode; detail?: string };
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-800 mb-1.5">Old Balance</h3>
      <div className="overflow-x-auto rounded-lg border border-amber-200">
        <table className="table-shell text-sm [&_th]:!px-2 [&_td]:!px-2">
          <thead>
            <tr>
              <th>Date</th>
              <th>Details</th>
              <th>Ref No.</th>
              <th className="!text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              if (r.type === 'bf') {
                return (
                  <tr key={r.key} className="bg-amber-50/60">
                    <td className="whitespace-nowrap">Before {formatDate(r.date)}</td>
                    <td className="font-medium">
                      Brought forward
                      <div className="text-[11px] font-normal text-ink-muted">{r.count} earlier entr{r.count === 1 ? 'y' : 'ies'}, net</div>
                    </td>
                    <td>-</td>
                    <td className="text-right whitespace-nowrap">{formatCurrency(r.amount)}</td>
                  </tr>
                );
              }
              const d = describe(r.entry.data);
              return (
                <tr key={r.key} className="bg-amber-50/60">
                  <td className="whitespace-nowrap">{formatDate(r.entry.date)}</td>
                  <td className="font-medium">
                    {d.label}
                    {d.detail && <div className="text-[11px] font-normal text-ink-muted">{d.detail}</div>}
                  </td>
                  <td className="whitespace-nowrap">{d.ref}</td>
                  <td className="text-right whitespace-nowrap">{formatCurrency(r.entry.debit ? r.entry.amount : -r.entry.amount)}</td>
                </tr>
              );
            })}
            {payments.map((p) => {
              const d = describe(p.entry.data);
              const part = p.amount < p.entry.amount;
              return (
                <tr key={p.key}>
                  <td className="whitespace-nowrap">{formatDate(p.entry.date)}</td>
                  <td className="text-emerald-700">
                    Payment
                    <div className="text-[11px] text-ink-muted">
                      {d.detail}
                      {part ? ` · part of ${formatCurrency(p.entry.amount)} payment` : ''}
                    </div>
                  </td>
                  <td className="whitespace-nowrap">{d.ref}</td>
                  <td className="text-right whitespace-nowrap text-emerald-700">− {formatCurrency(p.amount)}</td>
                </tr>
              );
            })}
            <tr className="bg-amber-50 font-semibold">
              <td></td>
              <td>Old balance still unpaid</td>
              <td></td>
              <td className="text-right whitespace-nowrap">{formatCurrency(oldUnpaid)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Bottom-of-ledger summary (same numbers as the boxes on top): every
// order/purchase and payment, then old and current kept apart, then the total.
export function LedgerFooterSummary({ totalLabel, totalDebits, totalPaid, oldUnpaid, currentBalance }: { totalLabel: string; totalDebits: number; totalPaid: number; oldUnpaid: number; currentBalance: number }) {
  const total = oldUnpaid + currentBalance;
  const cell = (label: string, value: number, tone = 'text-ink') => (
    <div className="px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`text-sm font-bold ${tone}`}>{formatCurrency(value)}</p>
    </div>
  );
  return (
    <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50/60">
      <p className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-brand-700">Summary</p>
      <div className="grid grid-cols-2 lg:grid-cols-5 divide-brand-100">
        {cell(totalLabel, totalDebits)}
        {cell('Total Paid', totalPaid, 'text-emerald-700')}
        {cell('Old Balance', oldUnpaid, oldUnpaid > 0 ? 'text-red-700' : 'text-ink')}
        {cell('Current Balance', currentBalance, currentBalance > 0 ? 'text-red-700' : 'text-emerald-700')}
        {cell('Total Balance (Old + Current)', total, total > 0 ? 'text-red-700' : 'text-emerald-700')}
      </div>
    </div>
  );
}
