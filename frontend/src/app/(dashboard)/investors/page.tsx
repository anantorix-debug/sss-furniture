'use client';

import { useMemo, useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { fetcher } from '@/lib/swr';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { formatCurrency, formatDate } from '@/lib/format';
import { downloadPdf } from '@/lib/sharePdf';
import { RoleGate } from '@/components/RoleGate';
import { StatCard } from '@/components/StatCard';
import { Chip } from '@/components/StatusBadge';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ActionsMenu } from '@/components/ActionsMenu';
import { InlineLoader } from '@/components/PageLoader';
import type { Investor, InvestorPnlBreakdown, InvestorPnlCalculation, InvestorTransaction } from '@/types';

type PeriodKey = 'this-month' | 'last-month' | 'this-year' | 'all' | 'custom';
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'this-month', label: 'This Month' },
  { key: 'last-month', label: 'Last Month' },
  { key: 'this-year', label: 'This Year' },
  { key: 'all', label: 'All Time' },
  { key: 'custom', label: 'Pick Dates' },
];

const PAYMENT_MODES: { value: string; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI-HDFC', label: 'UPI-HDFC' },
  { value: 'IOB', label: 'IOB' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'GPAY', label: 'GPay' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'OTHER', label: 'Other' },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => iso(new Date());
const modeLabel = (mode?: string | null) => PAYMENT_MODES.find((m) => m.value === mode)?.label ?? mode ?? '-';

// Everything on this page reads from /investors..., so any save refreshes it all.
const refreshAll = () => globalMutate((key) => typeof key === 'string' && key.startsWith('/investors'));

type MoneyTarget =
  | { kind: 'add'; investor: Investor }
  | { kind: 'pay'; investor: Investor; share?: InvestorPnlBreakdown }
  | { kind: 'edit'; investor: Investor; tx: InvestorTransaction };

export default function InvestorsPage() {
  const [periodKey, setPeriodKey] = useState<PeriodKey>('this-month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [formInvestor, setFormInvestor] = useState<Investor | 'new' | null>(null);
  const [moneyTarget, setMoneyTarget] = useState<MoneyTarget | null>(null);
  const [historyInvestor, setHistoryInvestor] = useState<Investor | null>(null);
  const [removeInvestor, setRemoveInvestor] = useState<Investor | null>(null);
  const [downloadingReport, setDownloadingReport] = useState(false);

  const range = useMemo(() => {
    const now = new Date();
    if (periodKey === 'this-month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
    if (periodKey === 'last-month') {
      return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
    }
    if (periodKey === 'this-year') return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
    if (periodKey === 'custom') return { from: customFrom || undefined, to: customTo || undefined };
    return { from: undefined, to: undefined };
  }, [periodKey, customFrom, customTo]);

  const rangeQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    return params;
  }, [range]);

  const { data: investors, isLoading: investorsLoading } = useSWR<Investor[]>('/investors', fetcher);
  const { data: pnl, isLoading: pnlLoading } = useSWR<InvestorPnlCalculation>(
    `/investors/pnl-calculation${rangeQuery.toString() ? `?${rangeQuery}` : ''}`,
    fetcher,
  );

  const periodLabel = PERIODS.find((p) => p.key === periodKey)?.label ?? '';
  const active = (investors ?? []).filter((i) => i.status === 'ACTIVE');
  const inactive = (investors ?? []).filter((i) => i.status !== 'ACTIVE');
  const shareOf = (id: string) => pnl?.investors.find((x) => x.id === id);
  const totalInvested = active.reduce((t, i) => t + i.totalInvested, 0);
  const isLoss = (pnl?.companyNetProfit ?? 0) < 0;
  const totalToPay = active.reduce((t, i) => t + Math.max(0, shareOf(i.id)?.balanceToDistribute ?? 0), 0);

  async function downloadReport() {
    setDownloadingReport(true);
    try {
      const params = new URLSearchParams(rangeQuery);
      params.set('periodLabel', periodLabel);
      await downloadPdf(`/investors/pnl-pdf?${params}`, `Profit_Report_${periodKey}_${today()}.pdf`);
      toast.success('Profit report downloaded');
    } catch {
      toast.error('Failed to download the profit report');
    } finally {
      setDownloadingReport(false);
    }
  }

  async function downloadStatement(investor: Investor) {
    try {
      await downloadPdf(`/investors/${investor.id}/statement-pdf`, `Investor_Statement_${investor.name.replace(/\s+/g, '_')}.pdf`);
      toast.success('Statement downloaded');
    } catch {
      toast.error('Failed to download the statement');
    }
  }

  async function confirmRemove() {
    if (!removeInvestor) return;
    try {
      const res = await api.delete<{ message?: string }>(`/investors/${removeInvestor.id}`);
      toast.success(res?.message || 'Investor removed');
      setRemoveInvestor(null);
      refreshAll();
    } catch {
      // error toast handled by api
    }
  }

  const rowMenu = (investor: Investor) => (
    <ActionsMenu
      items={[
        { label: 'View History', onClick: () => setHistoryInvestor(investor) },
        { label: 'Download Statement', onClick: () => downloadStatement(investor) },
        { label: 'Edit Details', onClick: () => setFormInvestor(investor) },
        { label: 'Remove', danger: true, onClick: () => setRemoveInvestor(investor) },
      ]}
    />
  );

  return (
    <RoleGate minRole="SUPERADMIN">
      <div className="space-y-5 pb-12">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-brand-900">Investors</h1>
            <p className="text-sm text-brand-500 mt-1">Who invested, their share of the profit, and what is still to pay them.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={downloadReport} disabled={downloadingReport}>
              {downloadingReport ? 'Preparing...' : 'Download Profit Report'}
            </button>
            <button className="btn-primary" onClick={() => setFormInvestor('new')}>
              + Add Investor
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-brand-800">Show profit for:</span>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={periodKey === p.key}
              onClick={() => setPeriodKey(p.key)}
              className={`rounded-full border px-3 py-1 text-sm font-medium ${
                periodKey === p.key ? 'border-brand-700 bg-brand-700 text-white' : 'border-brand-100 bg-white text-brand-700 hover:bg-brand-50'
              }`}
            >
              {p.label}
            </button>
          ))}
          {periodKey === 'custom' && (
            <span className="flex flex-wrap items-center gap-2">
              <input type="date" aria-label="From date" className="input !py-1 w-auto" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <span className="text-sm text-brand-500">to</span>
              <input type="date" aria-label="To date" className="input !py-1 w-auto" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Money In"
            accent="success"
            value={pnl ? formatCurrency(pnl.revenue.total) : '-'}
            sub={pnl ? `Customers ${formatCurrency(pnl.revenue.retail)} + Party ${formatCurrency(pnl.revenue.wholesale)}` : undefined}
          />
          <StatCard
            label="Money Out"
            accent="warning"
            value={pnl ? formatCurrency(pnl.costs.total) : '-'}
            sub={pnl ? `Suppliers ${formatCurrency(pnl.costs.materials)} + Workers ${formatCurrency(pnl.costs.labour)} + Expenses ${formatCurrency(pnl.costs.expenses)}` : undefined}
          />
          <StatCard
            label={isLoss ? 'Loss' : 'Profit'}
            accent={isLoss ? 'warning' : 'success'}
            value={pnl ? formatCurrency(pnl.companyNetProfit) : '-'}
            sub="Money In minus Money Out"
          />
          <StatCard
            label="Investors' Money"
            value={investors ? formatCurrency(totalInvested) : '-'}
            sub={`${active.length} active investor${active.length === 1 ? '' : 's'}`}
          />
        </div>

        <div className="card overflow-x-auto">
          <table className="table-shell">
            <thead>
              <tr>
                <th>Investor</th>
                <th className="!text-right">Invested</th>
                <th className="!text-center">Share</th>
                <th className="!text-right">Profit Share</th>
                <th className="!text-right">Paid</th>
                <th className="!text-right">To Pay</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(investorsLoading || pnlLoading) && !investors && (
                <tr>
                  <td colSpan={7} className="py-6">
                    <InlineLoader label="Loading investors..." />
                  </td>
                </tr>
              )}
              {investors && active.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-brand-400 py-8">
                    No active investors yet. Click &quot;+ Add Investor&quot; to begin.
                  </td>
                </tr>
              )}
              {active.map((inv) => {
                const share = shareOf(inv.id);
                const toPay = Math.max(0, share?.balanceToDistribute ?? 0);
                return (
                  <tr key={inv.id}>
                    <td>
                      <p className="font-semibold text-brand-900">{inv.name}</p>
                      {inv.phone && <p className="text-xs text-brand-500">{inv.phone}</p>}
                    </td>
                    <td className="text-right whitespace-nowrap">{formatCurrency(inv.totalInvested)}</td>
                    <td className="text-center whitespace-nowrap">
                      <p className="font-semibold">{inv.effectiveSharePercentage ?? 0}%</p>
                      <p className="text-xs text-brand-500">{inv.isDynamicShare ? 'By investment' : 'Fixed'}</p>
                    </td>
                    <td className={`text-right whitespace-nowrap font-semibold ${(share?.allocatedProfit ?? 0) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                      {share ? formatCurrency(share.allocatedProfit) : '-'}
                    </td>
                    <td className="text-right whitespace-nowrap">{share ? formatCurrency(share.payoutsInPeriod) : '-'}</td>
                    <td className={`text-right whitespace-nowrap font-bold ${toPay > 0 ? 'text-amber-700' : 'text-brand-500'}`}>{formatCurrency(toPay)}</td>
                    <td className="text-right whitespace-nowrap">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        <button className="btn-secondary text-xs" onClick={() => setMoneyTarget({ kind: 'add', investor: inv })}>
                          + Add Money
                        </button>
                        <button className="btn-primary text-xs" onClick={() => setMoneyTarget({ kind: 'pay', investor: inv, share })}>
                          Pay
                        </button>
                        {rowMenu(inv)}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {active.length > 0 && pnl && (
                <tr className="bg-brand-50/60 font-semibold">
                  <td>Total</td>
                  <td className="text-right whitespace-nowrap">{formatCurrency(totalInvested)}</td>
                  <td></td>
                  <td className={`text-right whitespace-nowrap ${pnl.totalAllocatedProfit < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatCurrency(pnl.totalAllocatedProfit)}</td>
                  <td className="text-right whitespace-nowrap">{formatCurrency(pnl.totalPayoutsInPeriod)}</td>
                  <td className="text-right whitespace-nowrap">{formatCurrency(totalToPay)}</td>
                  <td></td>
                </tr>
              )}
              {showInactive &&
                inactive.map((inv) => (
                  <tr key={inv.id} className="opacity-70">
                    <td>
                      <p className="font-semibold text-brand-900">{inv.name}</p>
                      {inv.phone && <p className="text-xs text-brand-500">{inv.phone}</p>}
                    </td>
                    <td className="text-right whitespace-nowrap">{formatCurrency(inv.totalInvested)}</td>
                    <td colSpan={4} className="text-center">
                      <Chip color="gray" label="Inactive: gets no profit share" />
                    </td>
                    <td className="text-right whitespace-nowrap">{rowMenu(inv)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-brand-600">
          <p>
            Profit Share, Paid and To Pay are for <strong>{periodLabel}</strong>.
            {pnl && !isLoss && <> Company keeps {formatCurrency(pnl.retainedCompanyProfit)} of the profit.</>}
            {isLoss && <> This period is a loss, so there is nothing to pay.</>}
          </p>
          {inactive.length > 0 && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show inactive ({inactive.length})
            </label>
          )}
        </div>

        {formInvestor && <InvestorForm investor={formInvestor === 'new' ? null : formInvestor} onClose={() => setFormInvestor(null)} />}
        {historyInvestor && (
          <HistoryModal
            investor={historyInvestor}
            onClose={() => setHistoryInvestor(null)}
            onDownload={() => downloadStatement(historyInvestor)}
            onEdit={(tx) => setMoneyTarget({ kind: 'edit', investor: historyInvestor, tx })}
          />
        )}
        {/* After History, so editing an entry opens on top of it. */}
        {moneyTarget && <MoneyForm target={moneyTarget} range={range} onClose={() => setMoneyTarget(null)} />}
        {removeInvestor && (
          <ConfirmDialog
            title="Remove Investor"
            message={`Remove ${removeInvestor.name}? If they have money entries, they become Inactive and their history is kept.`}
            confirmLabel="Remove"
            danger
            onConfirm={confirmRemove}
            onCancel={() => setRemoveInvestor(null)}
          />
        )}
      </div>
    </RoleGate>
  );
}

function ModeSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const known = PAYMENT_MODES.some((m) => m.value === value);
  return (
    <select id={id} className="input w-full" value={value} onChange={(e) => onChange(e.target.value)}>
      {!known && value && <option value={value}>{value}</option>}
      {PAYMENT_MODES.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

function InvestorForm({ investor, onClose }: { investor: Investor | null; onClose: () => void }) {
  const isEdit = Boolean(investor);
  const [name, setName] = useState(investor?.name ?? '');
  const [phone, setPhone] = useState(investor?.phone ?? '');
  const [joinedDate, setJoinedDate] = useState(investor?.joinedDate ? investor.joinedDate.slice(0, 10) : today());
  const [fixedShare, setFixedShare] = useState(investor?.sharePercentage != null);
  const [sharePercentage, setSharePercentage] = useState(investor?.sharePercentage != null ? String(investor.sharePercentage) : '');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('UPI-HDFC');
  const [reference, setReference] = useState('');
  const [email, setEmail] = useState(investor?.email ?? '');
  const [panNumber, setPanNumber] = useState(investor?.panNumber ?? '');
  const [bankDetails, setBankDetails] = useState(investor?.bankDetails ?? '');
  const [address, setAddress] = useState(investor?.address ?? '');
  const [notes, setNotes] = useState(investor?.notes ?? '');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(investor?.status ?? 'ACTIVE');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Enter the investor name');
      return;
    }
    if (fixedShare && !(Number(sharePercentage) > 0)) {
      toast.error('Enter the fixed share %');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        panNumber: panNumber.trim() || undefined,
        bankDetails: bankDetails.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
        joinedDate,
        status,
        // Editing back to "By investment" has to clear a saved fixed share.
        sharePercentage: fixedShare ? Number(sharePercentage) : isEdit ? null : undefined,
      };
      if (isEdit && investor) {
        await api.patch(`/investors/${investor.id}`, payload);
        toast.success('Investor updated');
      } else {
        if (Number(amount) > 0) {
          payload.initialInvestment = Number(amount);
          payload.initialPaymentMode = mode;
          payload.initialReference = reference.trim() || undefined;
        }
        await api.post('/investors', payload);
        toast.success('Investor added');
      }
      refreshAll();
      onClose();
    } catch {
      // toast shown by apiFetch
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? `Edit ${investor?.name}` : 'Add Investor'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="inv-name">Name *</label>
            <input id="inv-name" className="input w-full" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="inv-phone">Phone</label>
            <input id="inv-phone" type="tel" className="input w-full" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>

        {!isEdit && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="inv-amount">Money Invested (₹)</label>
              <input id="inv-amount" type="number" step="0.01" min="0" className="input w-full" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="inv-mode">Paid By</label>
              <ModeSelect id="inv-mode" value={mode} onChange={setMode} />
            </div>
          </div>
        )}

        <div>
          <p className="label">Profit Share</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer ${!fixedShare ? 'border-brand-600 bg-brand-50' : 'border-brand-100'}`}>
              <input type="radio" name="share" className="mt-0.5" checked={!fixedShare} onChange={() => setFixedShare(false)} />
              <span className="text-sm">
                <strong className="block text-brand-900">By investment</strong>
                <span className="text-xs text-brand-500">Worked out from their part of the investors&apos; money</span>
              </span>
            </label>
            <label className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer ${fixedShare ? 'border-brand-600 bg-brand-50' : 'border-brand-100'}`}>
              <input type="radio" name="share" className="mt-0.5" checked={fixedShare} onChange={() => setFixedShare(true)} />
              <span className="text-sm">
                <strong className="block text-brand-900">Fixed %</strong>
                <span className="text-xs text-brand-500">The same % of profit every time</span>
              </span>
            </label>
          </div>
          {fixedShare && (
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="100"
              aria-label="Fixed share percent"
              placeholder="Share %, for example 15"
              className="input w-full mt-2"
              value={sharePercentage}
              onChange={(e) => setSharePercentage(e.target.value)}
            />
          )}
        </div>

        <details className="rounded-lg border border-brand-100">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-brand-700">More details (optional)</summary>
          <div className="px-3 pb-3 pt-1 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="inv-date">Joined Date</label>
                <input id="inv-date" type="date" className="input w-full" value={joinedDate} onChange={(e) => setJoinedDate(e.target.value)} />
              </div>
              {isEdit ? (
                <div>
                  <label className="label" htmlFor="inv-status">Status</label>
                  <select id="inv-status" className="input w-full" value={status} onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive (no profit share)</option>
                  </select>
                </div>
              ) : (
                <div>
                  <label className="label" htmlFor="inv-ref">Payment Ref / UTR</label>
                  <input id="inv-ref" className="input w-full" value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
              )}
              <div>
                <label className="label" htmlFor="inv-email">Email</label>
                <input id="inv-email" type="email" className="input w-full" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="inv-pan">PAN</label>
                <input id="inv-pan" className="input w-full uppercase" value={panNumber} onChange={(e) => setPanNumber(e.target.value.toUpperCase())} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="inv-bank">Bank / UPI Details</label>
              <input id="inv-bank" className="input w-full" value={bankDetails} onChange={(e) => setBankDetails(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="inv-address">Address</label>
              <input id="inv-address" className="input w-full" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="inv-notes">Notes</label>
              <textarea id="inv-notes" rows={2} className="input w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </details>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : isEdit ? 'Save' : 'Add Investor'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MoneyForm({ target, range, onClose }: { target: MoneyTarget; range: { from?: string; to?: string }; onClose: () => void }) {
  const editing = target.kind === 'edit' ? target.tx : null;
  const isPay = target.kind === 'pay' || editing?.type === 'PAYOUT';
  const share = target.kind === 'pay' ? target.share : undefined;
  const suggested = Math.max(0, share?.balanceToDistribute ?? 0);

  const [amount, setAmount] = useState(editing ? String(editing.amount) : suggested > 0 ? String(suggested) : '');
  const [date, setDate] = useState(editing ? editing.date.slice(0, 10) : today());
  const [mode, setMode] = useState(editing?.paymentMode ?? 'UPI-HDFC');
  const [reference, setReference] = useState(editing?.reference ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!(Number(amount) > 0)) {
      toast.error('Enter the amount');
      return;
    }
    setSaving(true);
    const common = { amount: Number(amount), date, paymentMode: mode, reference: reference.trim() || undefined, notes: notes.trim() || undefined };
    try {
      if (editing) {
        await api.patch(`/investors/transactions/${editing.id}`, common);
        toast.success('Entry updated');
      } else if (target.kind === 'pay') {
        await api.post('/investors/distribute-profit', { ...common, investorId: target.investor.id, periodFrom: range.from, periodTo: range.to });
        toast.success(`${formatCurrency(Number(amount))} paid to ${target.investor.name} recorded`);
      } else {
        await api.post(`/investors/${target.investor.id}/transactions`, { ...common, type: 'INVESTMENT' });
        toast.success(`${formatCurrency(Number(amount))} added for ${target.investor.name}`);
      }
      refreshAll();
      onClose();
    } catch {
      // toast shown by apiFetch
    } finally {
      setSaving(false);
    }
  }

  const title = editing ? `Edit Entry: ${target.investor.name}` : isPay ? `Pay ${target.investor.name}` : `Add Money: ${target.investor.name}`;

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {!editing && !isPay && <p className="text-sm text-brand-600">Money this investor is putting into the business.</p>}
        {share && (
          <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-3 text-sm space-y-1">
            <div className="flex justify-between"><span>Profit share</span><strong>{formatCurrency(share.allocatedProfit)}</strong></div>
            <div className="flex justify-between"><span>Already paid</span><strong>{formatCurrency(share.payoutsInPeriod)}</strong></div>
            <div className="flex justify-between border-t border-brand-200 pt-1"><span>To pay</span><strong>{formatCurrency(suggested)}</strong></div>
          </div>
        )}
        <div>
          <label className="label" htmlFor="money-amount">Amount (₹) *</label>
          <input id="money-amount" type="number" step="0.01" min="0.01" required className="input w-full text-base font-bold" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="money-date">Date</label>
            <input id="money-date" type="date" required className="input w-full" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="money-mode">Paid By</label>
            <ModeSelect id="money-mode" value={mode} onChange={setMode} />
          </div>
        </div>
        <details className="rounded-lg border border-brand-100" open={Boolean(editing?.reference || editing?.notes)}>
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-brand-700">Ref No / Notes (optional)</summary>
          <div className="px-3 pb-3 pt-1 space-y-3">
            <div>
              <label className="label" htmlFor="money-ref">Ref No / UTR</label>
              <input id="money-ref" className="input w-full" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="money-notes">Notes</label>
              <input id="money-notes" className="input w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </details>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : editing ? 'Save' : isPay ? 'Record Payment' : 'Add Money'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function HistoryModal({
  investor,
  onClose,
  onDownload,
  onEdit,
}: {
  investor: Investor;
  onClose: () => void;
  onDownload: () => void;
  onEdit: (tx: InvestorTransaction) => void;
}) {
  const { data } = useSWR<Investor>(`/investors/${investor.id}`, fetcher, { fallbackData: investor });
  const inv = data ?? investor;
  const [deleteTx, setDeleteTx] = useState<InvestorTransaction | null>(null);

  async function confirmDelete() {
    if (!deleteTx) return;
    try {
      await api.delete(`/investors/transactions/${deleteTx.id}`);
      toast.success('Entry deleted');
      setDeleteTx(null);
      refreshAll();
    } catch {
      // toast shown by apiFetch
    }
  }

  return (
    <Modal title={`${inv.name}: History`} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-5 text-sm">
            <span>Invested <strong className="text-emerald-700">{formatCurrency(inv.totalInvested)}</strong></span>
            <span>Paid to them <strong className="text-brand-900">{formatCurrency(inv.totalPayouts)}</strong></span>
            <span className="text-brand-500">Joined {formatDate(inv.joinedDate)}</span>
          </div>
          <button className="btn-secondary text-sm" onClick={onDownload}>Download Statement</button>
        </div>
        {(inv.phone || inv.email || inv.panNumber || inv.bankDetails) && (
          <p className="text-xs text-brand-500">{[inv.phone, inv.email, inv.panNumber && `PAN ${inv.panNumber}`, inv.bankDetails].filter(Boolean).join(' · ')}</p>
        )}
        <div className="overflow-x-auto rounded-lg border border-brand-100 max-h-80 overflow-y-auto">
          <table className="table-shell text-sm">
            <thead>
              <tr>
                <th>Date</th>
                <th>Entry</th>
                <th className="!text-right">Amount</th>
                <th>Paid By</th>
                <th>Ref No</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!inv.transactions?.length && (
                <tr>
                  <td colSpan={6} className="text-center text-brand-400 py-6">No entries yet.</td>
                </tr>
              )}
              {inv.transactions?.map((tx) => (
                <tr key={tx.id}>
                  <td className="whitespace-nowrap">{formatDate(tx.date)}</td>
                  <td>
                    <span className={tx.type === 'INVESTMENT' ? 'font-medium text-emerald-700' : 'font-medium text-blue-700'}>
                      {tx.type === 'INVESTMENT' ? 'Money invested' : 'Paid to investor'}
                    </span>
                    {tx.notes && <p className="text-xs text-brand-500">{tx.notes}</p>}
                  </td>
                  <td className="text-right whitespace-nowrap font-semibold">{formatCurrency(tx.amount)}</td>
                  <td className="whitespace-nowrap">{modeLabel(tx.paymentMode)}</td>
                  <td>{tx.reference || '-'}</td>
                  <td className="text-right whitespace-nowrap">
                    <button className="text-xs font-medium text-brand-700 hover:underline mr-3" onClick={() => onEdit(tx)}>Edit</button>
                    <button className="text-xs font-medium text-red-600 hover:underline" onClick={() => setDeleteTx(tx)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
      {deleteTx && (
        <ConfirmDialog
          title="Delete Entry"
          message={`Delete this ${formatCurrency(deleteTx.amount)} entry from ${formatDate(deleteTx.date)}?`}
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTx(null)}
        />
      )}
    </Modal>
  );
}
