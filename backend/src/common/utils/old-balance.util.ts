// An Old Balance / opening-balance entry, recognised by its text ("OLD
// BALANCE", "OPENING BALANCE", "B/F", "BROUGHT FORWARD"). Same rule as the
// frontend lib/ledger.ts: these are listed first in a Payment Ledger and
// counted in the "Old Balance" box, apart from current activity.
const OLD_BALANCE_RE = /\b(OLD\s*BAL(ANCE)?|OPENING\s*BAL(ANCE)?|BROUGHT\s*FORWARD|B\s*\/\s*F)\b/i;

export function isOldBalance(text: string | null | undefined): boolean {
  return OLD_BALANCE_RE.test(text ?? '');
}

// Old Balance entries first (oldest first), then everything else by date,
// a debit (order / purchase) before a payment on the same day.
export function ledgerOrder<T extends { date: Date | string; old: boolean; debit: boolean }>(a: T, b: T): number {
  if (a.old !== b.old) return a.old ? -1 : 1;
  const da = new Date(a.date).toISOString().slice(0, 10);
  const db = new Date(b.date).toISOString().slice(0, 10);
  return da.localeCompare(db) || (a.debit === b.debit ? 0 : a.debit ? -1 : 1);
}

// The four Payment Ledger boxes, as PDF summary HTML.
export function ledgerSummaryHtml(oldBalance: number, newDebits: number, paid: number, newLabel: string, rupees: (n: number) => string): string {
  const current = oldBalance + newDebits - paid;
  // Own layout (not the shared .summary class, whose nested-div styling
  // draws boxes inside boxes and wraps a 4th box onto its own line).
  const box = (label: string, value: number, color = '#1f2933') =>
    `<td style="width:25%;padding:0 5px"><span style="display:block;border:1px solid #e3e1d9;border-radius:8px;padding:9px 12px">` +
    `<span style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280">${label}</span>` +
    `<span style="display:block;font-size:15px;font-weight:bold;margin-top:2px;color:${color}">${rupees(value)}</span></span></td>`;
  return `<table style="width:calc(100% + 10px);margin:0 -5px 16px;border-collapse:separate"><tr>${box('Old Balance', oldBalance)}${box(newLabel, newDebits)}${box('Paid', paid, '#15803d')}${box('Current Balance', current, current > 0 ? '#b91c1c' : '#15803d')}</tr></table>`;
}
