// Old Balance handling for the Payment Ledger PDFs (Party Orders shop and
// Purchasing supplier) - same rules as the screens (frontend lib/ledger.ts):
// entries whose text says OLD BALANCE / OPENING BALANCE / B/F / BROUGHT
// FORWARD go in their own Old Balance table; everything else is the current
// ledger, whose running balance starts at zero. The two never mix: a
// payment reduces the current balance; the old balance goes down only by
// payments recorded for it (fixedOld). Total = order value only.
const OLD_BALANCE_RE = /\b(OLD\s*BAL(ANCE)?|OPENING\s*BAL(ANCE)?|BROUGHT\s*FORWARD|B\s*\/\s*F)\b/i;

export function isOldBalance(text: string | null | undefined): boolean {
  return OLD_BALANCE_RE.test(text ?? '');
}

export interface PdfLedgerEntry {
  date: Date;
  amount: number;
  debit: boolean; // order / purchase
  old: boolean;
  title: string; // Order / Purchase / Payment / Cancelled ...
  ref: string;
  detail: string; // product names, or "Payment Type: CASH"
  txnBal?: number | null; // still owed on that order (orders only)
  // Payments only: the part actually stored against Old Balance orders
  // (party shops). When set it is used as-is instead of the rule.
  fixedOld?: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const day = (d: Date) => new Date(d).toISOString().slice(0, 10);

// totals: labels for the overall row on top (same as the page's cards),
// e.g. ['Total Order Value', 'Total Paid', 'Total Balance'].
export function renderLedgerTables(
  entries: PdfLedgerEntry[],
  rupees: (n: number) => string,
  fmt: (d: Date) => string,
  totals: [string, string, string] = ['Total Order Value', 'Total Paid', 'Total Balance'],
): string {
  const sorted = [...entries].sort((a, b) => day(a.date).localeCompare(day(b.date)) || (a.debit === b.debit ? 0 : a.debit ? -1 : 1));
  const old = sorted.filter((e) => e.old);
  const current = sorted.filter((e) => !e.old);
  const oldTotal = old.reduce((t, e) => t + (e.debit ? e.amount : -e.amount), 0);

  let oldLeft = Math.max(0, oldTotal);
  let running = 0;
  let newDebits = 0;
  let paid = 0;
  const oldPayments: { e: PdfLedgerEntry; amount: number }[] = [];
  const body = current
    .map((e) => {
      let towardsOld = 0;
      if (e.debit) {
        newDebits += e.amount;
        running += e.amount;
      } else {
        paid += e.amount;
        towardsOld = Math.min(e.fixedOld ?? 0, e.amount);
        oldLeft -= towardsOld;
        if (towardsOld > 0) oldPayments.push({ e, amount: towardsOld });
        running -= e.amount - towardsOld;
      }
      const tint = e.debit ? '' : 'background:#f0fdf4';
      return `<tr style="${tint}">
          <td>${fmt(e.date)}</td>
          <td style="font-weight:600">${esc(e.title)}</td>
          <td style="white-space:nowrap">${esc(e.ref)}</td>
          <td style="text-align:right">${e.debit ? rupees(e.amount) : ''}</td>
          <td style="text-align:right">${e.debit ? '' : rupees(e.amount)}</td>
          <td style="text-align:right">${e.debit && e.txnBal != null ? rupees(e.txnBal) : ''}</td>
          <td style="text-align:right;font-weight:600">${rupees(running)}</td>
        </tr>
        <tr style="${tint}"><td></td><td colspan="6" style="font-size:10.5px;color:#6b7280;padding-top:0">${esc(e.detail)}${
          towardsOld > 0 ? ` <span style="color:#92400e">· ${rupees(towardsOld)} towards Old Balance</span>` : ''
        }</td></tr>`;
    })
    .join('');
  const paidToOld = Math.max(0, oldTotal) - oldLeft;
  const oldUnpaid = oldTotal - paidToOld;

  const box = (label: string, value: number, color = '#1f2933', width = '33.3%') =>
    `<td style="width:${width};padding:0 5px"><span style="display:block;border:1px solid #e3e1d9;border-radius:8px;padding:9px 12px">` +
    `<span style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280">${label}</span>` +
    `<span style="display:block;font-size:15px;font-weight:bold;margin-top:2px;color:${color}">${rupees(value)}</span></span></td>`;
  // Overall totals - every order/purchase and every payment, old and new.
  const allDebits = entries.filter((e) => e.debit).reduce((t, e) => t + e.amount, 0);
  const allPaid = entries.filter((e) => !e.debit).reduce((t, e) => t + e.amount, 0);
  const overall = `<table style="width:calc(100% + 10px);margin:0 -5px 10px;border-collapse:separate"><tr>${box(totals[0], allDebits)}${box(totals[1], allPaid, '#15803d')}${box(totals[2], allDebits - allPaid, allDebits - allPaid > 0 ? '#b91c1c' : '#15803d')}</tr></table>`;
  const boxes = `<table style="width:calc(100% + 10px);margin:0 -5px 16px;border-collapse:separate"><tr>${box('Old Balance', oldUnpaid, oldUnpaid > 0 ? '#b91c1c' : '#1f2933', '25%')}${box('Current Balance', running, running > 0 ? '#b91c1c' : '#15803d', '25%')}${box('Paid', paid, '#15803d', '25%')}${box('Old + Current', oldUnpaid + running, oldUnpaid + running > 0 ? '#b91c1c' : '#15803d', '25%')}</tr></table>`;

  const oldTable = old.length
    ? `<h3 style="font-size:12px;letter-spacing:0.5px;text-transform:uppercase;color:#92400e;margin:4px 0 6px">Old Balance</h3>
    <table style="margin-bottom:16px">
      <thead><tr><th>Date</th><th>Details</th><th>Ref No.</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>
        ${old
          .map(
            (e) => `<tr style="background:#fffbeb"><td>${fmt(e.date)}</td><td><b>${e.debit ? 'Old Balance' : 'Payment'}</b><div style="font-size:10.5px;color:#6b7280">${esc(e.detail)}</div></td><td>${esc(e.ref)}</td><td style="text-align:right">${rupees(e.debit ? e.amount : -e.amount)}</td></tr>`,
          )
          .join('')}
        ${oldPayments
          .map(
            (p) => `<tr><td>${fmt(p.e.date)}</td><td style="color:#15803d">Payment<div style="font-size:10.5px;color:#6b7280">${esc(p.e.detail)}${
              p.amount < p.e.amount ? ` · part of ${rupees(p.e.amount)} payment` : ''
            }</div></td><td>${esc(p.e.ref)}</td><td style="text-align:right;color:#15803d">- ${rupees(p.amount)}</td></tr>`,
          )
          .join('')}
        <tr style="font-weight:bold;background:#fef3c7"><td></td><td>Old balance still unpaid</td><td></td><td style="text-align:right">${rupees(oldUnpaid)}</td></tr>
      </tbody>
    </table>
    <h3 style="font-size:12px;letter-spacing:0.5px;text-transform:uppercase;color:#80011f;margin:4px 0 6px">Current Ledger</h3>`
    : '';

  return `${overall}
    ${boxes}
    ${oldTable}
    <table>
      <thead><tr><th>Date</th><th>Txn Type</th><th>Ref No.</th><th style="text-align:right">Total</th><th style="text-align:right">Paid</th><th style="text-align:right">Txn Bal.</th><th style="text-align:right">Running Balance</th></tr></thead>
      <tbody>
        ${body || '<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:16px">No entries</td></tr>'}
        ${current.length ? `<tr style="font-weight:bold;background:#e5e7eb"><td></td><td>Total</td><td></td><td style="text-align:right">${rupees(newDebits)}</td><td style="text-align:right">${rupees(paid)}</td><td></td><td style="text-align:right">${rupees(running)}</td></tr>` : ''}
      </tbody>
    </table>
    <h3 style="font-size:12px;letter-spacing:0.5px;text-transform:uppercase;color:#80011f;margin:16px 0 6px;break-after:avoid">Summary</h3>
    <table style="break-inside:avoid">
      <tbody>
        <tr><td>${totals[0]}</td><td style="text-align:right">${rupees(allDebits)}</td></tr>
        <tr><td>${totals[1]}</td><td style="text-align:right;color:#15803d">${rupees(allPaid)}</td></tr>
        <tr><td>Old Balance (still unpaid)</td><td style="text-align:right">${rupees(oldUnpaid)}</td></tr>
        <tr><td>Current Balance</td><td style="text-align:right">${rupees(running)}</td></tr>
        <tr style="font-weight:bold;background:#fef3c7"><td>${totals[2]} (Old + Current)</td><td style="text-align:right">${rupees(oldUnpaid + running)}</td></tr>
      </tbody>
    </table>
`;
}
