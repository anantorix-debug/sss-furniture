'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { formatCurrency, formatDate } from '@/lib/format';
import { sharePdf } from '@/lib/sharePdf';
import { RoleGate } from '@/components/RoleGate';
import { StatCard } from '@/components/StatCard';
import { Chip } from '@/components/StatusBadge';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { InlineLoader } from '@/components/PageLoader';
import type {
  Investor,
  InvestorPnlBreakdown,
  InvestorPnlCalculation,
  InvestorStats,
  InvestorTransaction,
  InvestorTransactionType,
} from '@/types';

// Periods for P&L calculation
type PeriodKey = 'this-month' | 'last-month' | 'last-3' | 'this-year' | 'all' | 'custom';
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'this-month', label: 'This Month' },
  { key: 'last-month', label: 'Last Month' },
  { key: 'last-3', label: 'Last 3 Months' },
  { key: 'this-year', label: 'This Year' },
  { key: 'all', label: 'All Time' },
  { key: 'custom', label: 'Custom Dates' },
];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const PAYMENT_MODES = [
  'BANK_TRANSFER',
  'UPI',
  'CASH',
  'CHEQUE',
  'NEFT',
  'RTGS',
  'GPAY',
  'OTHER',
];

export default function InvestorsPage() {
  const [activeTab, setActiveTab] = useState<'pnl' | 'investors' | 'transactions'>('pnl');

  // Search & Filter for Investors List
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // P&L Period Filter
  const [periodKey, setPeriodKey] = useState<PeriodKey>('this-month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Modals state
  const [investorModalOpen, setInvestorModalOpen] = useState(false);
  const [editingInvestor, setEditingInvestor] = useState<Investor | null>(null);

  const [transactionModalOpen, setTransactionModalOpen] = useState(false);
  const [transactionInvestor, setTransactionInvestor] = useState<Investor | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<InvestorTransaction | null>(null);
  const [defaultTxType, setDefaultTxType] = useState<InvestorTransactionType>('INVESTMENT');

  const [detailModalInvestor, setDetailModalInvestor] = useState<Investor | null>(null);
  const [confirmDeleteInvestor, setConfirmDeleteInvestor] = useState<Investor | null>(null);
  const [confirmDeleteTx, setConfirmDeleteTx] = useState<{ id: string; name: string } | null>(null);

  // Quick Distribute Modal State
  const [quickDistributeOpen, setQuickDistributeOpen] = useState(false);
  const [distributeTarget, setDistributeTarget] = useState<InvestorPnlBreakdown | null>(null);
  const [downloadingPnlPdf, setDownloadingPnlPdf] = useState(false);

  // Compute date range for SWR URL
  const range = useMemo(() => {
    const now = new Date();
    if (periodKey === 'this-month') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: iso(from), to: iso(now) };
    }
    if (periodKey === 'last-month') {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: iso(from), to: iso(to) };
    }
    if (periodKey === 'last-3') {
      const from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      return { from: iso(from), to: iso(now) };
    }
    if (periodKey === 'this-year') {
      const from = new Date(now.getFullYear(), 0, 1);
      return { from: iso(from), to: iso(now) };
    }
    if (periodKey === 'custom') {
      return { from: customFrom || undefined, to: customTo || undefined };
    }
    return { from: undefined, to: undefined };
  }, [periodKey, customFrom, customTo]);

  // SWR queries
  const { data: stats, mutate: mutateStats } = useSWR<InvestorStats>('/investors/stats', fetcher);

  const investorsUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (statusFilter !== 'ALL') params.set('status', statusFilter);
    const qs = params.toString();
    return `/investors${qs ? `?${qs}` : ''}`;
  }, [search, statusFilter]);

  const { data: investors, isLoading: investorsLoading, mutate: mutateInvestors } = useSWR<Investor[]>(
    investorsUrl,
    fetcher,
  );

  const pnlUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    const qs = params.toString();
    return `/investors/pnl-calculation${qs ? `?${qs}` : ''}`;
  }, [range]);

  const { data: pnlData, isLoading: pnlLoading, mutate: mutatePnl } = useSWR<InvestorPnlCalculation>(
    pnlUrl,
    fetcher,
  );

  // Refresh all data
  const refreshAll = () => {
    mutateStats();
    mutateInvestors();
    mutatePnl();
  };

  // Compile all transactions across investors for Transactions tab
  const allTransactions = useMemo(() => {
    if (!investors) return [];
    const list: (InvestorTransaction & { investorName: string })[] = [];
    for (const inv of investors) {
      if (inv.transactions) {
        for (const tx of inv.transactions) {
          list.push({ ...tx, investorName: inv.name });
        }
      }
    }
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [investors]);

  // Handle investor delete
  async function handleDeleteInvestor() {
    if (!confirmDeleteInvestor) return;
    try {
      const res = await api.delete<{ success: boolean; message: string }>(`/investors/${confirmDeleteInvestor.id}`);
      toast.success(res?.message || 'Investor updated successfully');
      setConfirmDeleteInvestor(null);
      refreshAll();
    } catch {
      // error toast handled by api
    }
  }

  // Handle transaction delete
  async function handleDeleteTransaction() {
    if (!confirmDeleteTx) return;
    try {
      await api.delete(`/investors/transactions/${confirmDeleteTx.id}`);
      toast.success('Transaction deleted');
      setConfirmDeleteTx(null);
      if (detailModalInvestor) {
        const updated = await api.get<Investor>(`/investors/${detailModalInvestor.id}`);
        setDetailModalInvestor(updated);
      }
      refreshAll();
    } catch {
      // error toast handled by api
    }
  }

  // Download Profit & Loss PDF Report
  async function handleDownloadPnlPdf() {
    setDownloadingPnlPdf(true);
    try {
      const params = new URLSearchParams();
      if (range.from) params.set('from', range.from);
      if (range.to) params.set('to', range.to);
      const activePeriodObj = PERIODS.find((p) => p.key === periodKey);
      if (activePeriodObj) params.set('periodLabel', activePeriodObj.label);

      const qs = params.toString();
      const filename = `Company_PnL_Report_${periodKey}_${new Date().toISOString().slice(0, 10)}.pdf`;
      await sharePdf(
        `/investors/pnl-pdf${qs ? `?${qs}` : ''}`,
        filename,
        `Company P&L Statement (${activePeriodObj?.label || 'Period'})`,
      );
      toast.success('P&L Report PDF generated');
    } catch {
      toast.error('Failed to download P&L report PDF');
    } finally {
      setDownloadingPnlPdf(false);
    }
  }

  // Download Statement PDF
  async function handleDownloadStatement(investorId: string, name: string) {
    try {
      await sharePdf(
        `/investors/${investorId}/statement-pdf`,
        `Investor_Statement_${name.replace(/\s+/g, '_')}.pdf`,
        `Investor Statement: ${name}`,
      );
    } catch {
      toast.error('Failed to download statement PDF');
    }
  }

  return (
    <RoleGate minRole="SUPERADMIN">
      <div className="space-y-5 pb-12">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-brand-900 tracking-tight">
                Investors Management
              </h1>
              <span className="text-[11px] font-semibold bg-brand-50 text-brand-700 px-2.5 py-0.5 rounded-full border border-brand-200">
                P&amp;L &amp; Dividend Control
              </span>
            </div>
            <p className="text-xs sm:text-sm text-brand-600 mt-0.5">
              Capital injections, automated profit/loss calculation, and dividend distributions
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadPnlPdf}
              disabled={downloadingPnlPdf}
              className="btn-secondary text-xs sm:text-sm flex items-center gap-1.5 shadow-sm border border-brand-200 hover:bg-brand-50"
              title="Download Profit & Loss Executive Statement PDF"
            >
              <svg className="w-4 h-4 text-brand-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>{downloadingPnlPdf ? 'Generating PDF...' : 'Download P&L PDF'}</span>
            </button>

            <button
              onClick={() => {
                setEditingInvestor(null);
                setInvestorModalOpen(true);
              }}
              className="btn-primary text-xs sm:text-sm flex items-center gap-1.5 shadow-sm"
            >
              <span>+</span>
              <span>Add Investor</span>
            </button>
          </div>
        </div>

        {/* Top Summary Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Total Invested Capital"
            value={stats ? formatCurrency(stats.totalCapitalInvested) : '—'}
            sub={`${stats?.activeInvestors ?? 0} active investors`}
            accent="success"
          />
          <StatCard
            label="Total Returns Distributed"
            value={stats ? formatCurrency(stats.totalPayoutsDistributed) : '—'}
            sub={stats?.overallRoi ? `Overall ROI: ${stats.overallRoi}%` : 'Dividends & Returns'}
            accent="default"
          />
          <StatCard
            label="Net Active Investment"
            value={stats ? formatCurrency(stats.netActiveCapital) : '—'}
            sub="Current capital locked in business"
            accent="default"
          />
          <StatCard
            label="Lifetime Company Profit"
            value={stats ? formatCurrency(stats.lifetimeCompanyNetProfit) : '—'}
            sub={`Revenue: ${stats ? formatCurrency(stats.lifetimeCompanyRevenue) : '—'}`}
            accent={stats && stats.lifetimeCompanyNetProfit >= 0 ? 'success' : 'warning'}
          />
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-brand-100 pb-2">
          <button
            onClick={() => setActiveTab('pnl')}
            className={`px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === 'pnl'
                ? 'bg-brand-700 text-white shadow-sm'
                : 'text-brand-700 hover:bg-brand-50'
            }`}
          >
            <span>📊</span>
            <span>Calculated Profit &amp; Loss</span>
          </button>
          <button
            onClick={() => setActiveTab('investors')}
            className={`px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === 'investors'
                ? 'bg-brand-700 text-white shadow-sm'
                : 'text-brand-700 hover:bg-brand-50'
            }`}
          >
            <span>👥</span>
            <span>Investors Directory ({investors?.length ?? 0})</span>
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === 'transactions'
                ? 'bg-brand-700 text-white shadow-sm'
                : 'text-brand-700 hover:bg-brand-50'
            }`}
          >
            <span>📜</span>
            <span>Transactions Ledger ({allTransactions.length})</span>
          </button>
        </div>

        {/* TAB 1: P&L AND PROFIT ALLOCATION CALCULATOR */}
        {activeTab === 'pnl' && (
          <div className="space-y-4">
            {/* Period Selector Controls */}
            <div className="card p-3 sm:p-4 bg-white border border-brand-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-brand-800 mr-1">Calculation Period:</span>
                {PERIODS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setPeriodKey(p.key)}
                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                      periodKey === p.key
                        ? 'bg-brand-700 text-white shadow-xs'
                        : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                {periodKey === 'custom' && (
                  <div className="flex items-center gap-2 text-xs">
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="input py-1 px-2 text-xs"
                    />
                    <span className="text-brand-400">to</span>
                    <input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="input py-1 px-2 text-xs"
                    />
                  </div>
                )}

                <button
                  onClick={handleDownloadPnlPdf}
                  disabled={downloadingPnlPdf}
                  className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1.5 border border-brand-200 hover:bg-brand-50 shadow-2xs"
                  title="Export Current Period Statement as PDF"
                >
                  <svg className="w-3.5 h-3.5 text-brand-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span>{downloadingPnlPdf ? 'Exporting...' : 'Export PDF'}</span>
                </button>
              </div>
            </div>

            {pnlLoading ? (
              <InlineLoader label="Calculating Company Profit & Loss and Investor Shares..." />
            ) : pnlData ? (
              <>
                {/* Financial Health Summary Banner */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Revenue Card */}
                  <div className="card p-4 bg-gradient-to-br from-emerald-50/70 to-white border border-emerald-200/80">
                    <p className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wide">
                      Money In (Revenue)
                    </p>
                    <p className="text-2xl font-bold text-emerald-700 mt-1">
                      {formatCurrency(pnlData.revenue.total)}
                    </p>
                    <div className="mt-2 text-[11px] text-emerald-900/80 space-y-0.5 border-t border-emerald-100 pt-2">
                      <div className="flex justify-between">
                        <span>Retail Sales:</span>
                        <span className="font-semibold">{formatCurrency(pnlData.revenue.retail)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Wholesale (Party):</span>
                        <span className="font-semibold">{formatCurrency(pnlData.revenue.wholesale)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Costs Card */}
                  <div className="card p-4 bg-gradient-to-br from-amber-50/70 to-white border border-amber-200/80">
                    <p className="text-[11px] font-semibold text-amber-800 uppercase tracking-wide">
                      Money Out (Costs &amp; Expenses)
                    </p>
                    <p className="text-2xl font-bold text-amber-800 mt-1">
                      {formatCurrency(pnlData.costs.total)}
                    </p>
                    <div className="mt-2 text-[11px] text-amber-900/80 space-y-0.5 border-t border-amber-100 pt-2">
                      <div className="flex justify-between">
                        <span>Material Purchases:</span>
                        <span className="font-semibold">{formatCurrency(pnlData.costs.materials)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Worker / Labour Pay:</span>
                        <span className="font-semibold">{formatCurrency(pnlData.costs.labour)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Company Expenses:</span>
                        <span className="font-semibold">{formatCurrency(pnlData.costs.expenses)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Net Profit Card */}
                  <div
                    className={`card p-4 border ${
                      pnlData.companyNetProfit >= 0
                        ? 'bg-gradient-to-br from-blue-50/70 to-white border-blue-200/80'
                        : 'bg-gradient-to-br from-red-50/70 to-white border-red-200/80'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p
                        className={`text-[11px] font-semibold uppercase tracking-wide ${
                          pnlData.companyNetProfit >= 0 ? 'text-blue-800' : 'text-red-800'
                        }`}
                      >
                        Net Period {pnlData.companyNetProfit >= 0 ? 'Profit' : 'Loss'}
                      </p>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          pnlData.companyNetProfit >= 0
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {pnlData.profitMargin}% Margin
                      </span>
                    </div>

                    <p
                      className={`text-2xl font-bold mt-1 ${
                        pnlData.companyNetProfit >= 0 ? 'text-blue-900' : 'text-red-700'
                      }`}
                    >
                      {formatCurrency(pnlData.companyNetProfit)}
                    </p>

                    <div className="mt-2 text-[11px] space-y-0.5 border-t border-brand-100 pt-2 text-brand-800">
                      <div className="flex justify-between">
                        <span>Total Investors Share:</span>
                        <span className="font-semibold text-brand-900">
                          {formatCurrency(pnlData.totalAllocatedProfit)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Retained for Company:</span>
                        <span className="font-semibold text-brand-900">
                          {formatCurrency(pnlData.retainedCompanyProfit)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Investor Profit Allocation Table */}
                <div className="card overflow-hidden border border-brand-100 shadow-sm">
                  <div className="px-4 py-3 bg-brand-50/60 border-b border-brand-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-brand-900">
                        Investor Profit &amp; Loss Distribution Matrix
                      </h3>
                      <p className="text-[11px] text-brand-600">
                        Calculated according to each investor&apos;s active capital ratio or fixed equity percentage
                      </p>
                    </div>

                    <div className="text-xs text-brand-700">
                      <span>Total Active Capital: </span>
                      <strong className="text-brand-900">{formatCurrency(pnlData.totalActiveCapital)}</strong>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-brand-50/40 text-brand-700 font-semibold border-b border-brand-100">
                        <tr>
                          <th className="px-4 py-2.5">Investor Name</th>
                          <th className="px-4 py-2.5 text-right">Active Capital</th>
                          <th className="px-4 py-2.5 text-center">Share %</th>
                          <th className="px-4 py-2.5 text-right">Calculated Profit</th>
                          <th className="px-4 py-2.5 text-right">Paid in Period</th>
                          <th className="px-4 py-2.5 text-right">Balance to Pay</th>
                          <th className="px-4 py-2.5 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-brand-50 text-brand-900">
                        {pnlData.investors.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-brand-400">
                              No active investors registered yet. Click &quot;Add Investor&quot; to begin.
                            </td>
                          </tr>
                        ) : (
                          pnlData.investors.map((inv) => (
                            <tr key={inv.id} className="hover:bg-brand-50/30 transition-colors">
                              <td className="px-4 py-3">
                                <p className="font-semibold text-brand-900">{inv.name}</p>
                                {inv.phone && <p className="text-[10px] text-brand-500">{inv.phone}</p>}
                              </td>

                              <td className="px-4 py-3 text-right font-medium">
                                {formatCurrency(inv.activeCapital)}
                              </td>

                              <td className="px-4 py-3 text-center">
                                <span className="inline-flex items-center gap-1 font-semibold text-brand-800 bg-brand-100/60 px-2 py-0.5 rounded text-[11px]">
                                  {inv.sharePercentage}%
                                  {inv.isDynamicShare && (
                                    <span
                                      className="text-[9px] text-brand-500 cursor-help"
                                      title="Calculated dynamically based on active capital share"
                                    >
                                      (dyn)
                                    </span>
                                  )}
                                </span>
                              </td>

                              <td className="px-4 py-3 text-right font-bold text-emerald-700">
                                {formatCurrency(inv.allocatedProfit)}
                              </td>

                              <td className="px-4 py-3 text-right text-brand-700">
                                {formatCurrency(inv.payoutsInPeriod)}
                              </td>

                              <td className="px-4 py-3 text-right font-bold">
                                <span
                                  className={
                                    inv.balanceToDistribute > 0
                                      ? 'text-amber-700'
                                      : inv.balanceToDistribute < 0
                                      ? 'text-red-700'
                                      : 'text-brand-500'
                                  }
                                >
                                  {formatCurrency(inv.balanceToDistribute)}
                                </span>
                              </td>

                              <td className="px-4 py-3 text-center">
                                <button
                                  onClick={() => {
                                    setDistributeTarget(inv);
                                    setQuickDistributeOpen(true);
                                  }}
                                  className="btn-secondary text-[11px] py-1 px-2.5 font-medium hover:bg-brand-700 hover:text-white transition-all shadow-2xs"
                                >
                                  💸 Pay Dividend
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        )}

        {/* TAB 2: INVESTORS DIRECTORY (CRUD) */}
        {activeTab === 'investors' && (
          <div className="space-y-4">
            {/* Search and Filters */}
            <div className="card p-3 sm:p-4 bg-white border border-brand-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="w-full sm:w-72">
                <input
                  type="text"
                  placeholder="Search by name, phone, PAN..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input w-full text-xs"
                />
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <span className="text-xs text-brand-600 font-medium">Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}
                  className="input text-xs py-1"
                >
                  <option value="ALL">All Status</option>
                  <option value="ACTIVE">Active Only</option>
                  <option value="INACTIVE">Inactive Only</option>
                </select>
              </div>
            </div>

            {/* Investors Table */}
            <div className="card overflow-hidden border border-brand-100 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-brand-50/50 text-brand-700 font-semibold border-b border-brand-100">
                    <tr>
                      <th className="px-4 py-3">Investor</th>
                      <th className="px-4 py-3">Contact &amp; Tax ID</th>
                      <th className="px-4 py-3 text-right">Total Invested</th>
                      <th className="px-4 py-3 text-right">Total Payouts</th>
                      <th className="px-4 py-3 text-right">Current Capital</th>
                      <th className="px-4 py-3 text-center">Share %</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-50 text-brand-900">
                    {investorsLoading ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center">
                          <InlineLoader label="Loading investors directory..." />
                        </td>
                      </tr>
                    ) : !investors || investors.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-brand-400">
                          No investors found matching the criteria.
                        </td>
                      </tr>
                    ) : (
                      investors.map((inv) => (
                        <tr key={inv.id} className="hover:bg-brand-50/30 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="h-7 w-7 rounded-full bg-brand-100 text-brand-800 flex items-center justify-center font-bold text-xs uppercase">
                                {inv.name.slice(0, 2)}
                              </span>
                              <div>
                                <p className="font-semibold text-brand-900">{inv.name}</p>
                                <p className="text-[10px] text-brand-400">
                                  Joined {formatDate(inv.joinedDate)}
                                </p>
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            {inv.phone && <p className="text-brand-700 font-mono">{inv.phone}</p>}
                            {inv.email && <p className="text-[10px] text-brand-500">{inv.email}</p>}
                            {inv.panNumber && (
                              <p className="text-[10px] text-brand-400 uppercase font-mono">
                                PAN: {inv.panNumber}
                              </p>
                            )}
                          </td>

                          <td className="px-4 py-3 text-right font-medium text-emerald-700">
                            {formatCurrency(inv.totalInvested)}
                          </td>

                          <td className="px-4 py-3 text-right font-medium text-blue-700">
                            {formatCurrency(inv.totalPayouts)}
                          </td>

                          <td className="px-4 py-3 text-right font-bold text-brand-900">
                            {formatCurrency(inv.currentBalance)}
                          </td>

                          <td className="px-4 py-3 text-center">
                            <span className="font-semibold text-brand-800 bg-brand-100/70 px-2 py-0.5 rounded text-[11px]">
                              {inv.effectiveSharePercentage != null
                                ? `${inv.effectiveSharePercentage}%`
                                : '—'}
                            </span>
                          </td>

                          <td className="px-4 py-3 text-center">
                            {inv.status === 'ACTIVE' ? (
                              <Chip color="green" label="Active" />
                            ) : (
                              <Chip color="gray" label="Inactive" />
                            )}
                          </td>

                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* View Details / Ledger */}
                              <button
                                onClick={() => setDetailModalInvestor(inv)}
                                title="View Ledger and Transactions"
                                className="px-2 py-1 rounded bg-brand-50 hover:bg-brand-100 text-brand-800 text-[11px] font-medium"
                              >
                                📋 Ledger
                              </button>

                              {/* Download Statement PDF */}
                              <button
                                onClick={() => handleDownloadStatement(inv.id, inv.name)}
                                title="Download Investor Statement PDF"
                                className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-900 text-[11px] font-medium flex items-center gap-1"
                              >
                                <span>📄</span>
                                <span>PDF</span>
                              </button>

                              {/* Add Capital */}
                              <button
                                onClick={() => {
                                  setTransactionInvestor(inv);
                                  setDefaultTxType('INVESTMENT');
                                  setEditingTransaction(null);
                                  setTransactionModalOpen(true);
                                }}
                                title="Add Capital Injection"
                                className="px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-medium"
                              >
                                + Capital
                              </button>

                              {/* Log Payout */}
                              <button
                                onClick={() => {
                                  setTransactionInvestor(inv);
                                  setDefaultTxType('PAYOUT');
                                  setEditingTransaction(null);
                                  setTransactionModalOpen(true);
                                }}
                                title="Log Return / Payout"
                                className="px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 text-[11px] font-medium"
                              >
                                💸 Payout
                              </button>

                              {/* Edit */}
                              <button
                                onClick={() => {
                                  setEditingInvestor(inv);
                                  setInvestorModalOpen(true);
                                }}
                                title="Edit Investor Details"
                                className="p-1 rounded text-brand-600 hover:text-brand-900 hover:bg-brand-50"
                              >
                                ✏️
                              </button>

                              {/* Delete / Deactivate */}
                              <button
                                onClick={() => setConfirmDeleteInvestor(inv)}
                                title="Delete or Deactivate Investor"
                                className="p-1 rounded text-red-500 hover:text-red-700 hover:bg-red-50"
                              >
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: ALL TRANSACTIONS LEDGER */}
        {activeTab === 'transactions' && (
          <div className="space-y-4">
            <div className="card overflow-hidden border border-brand-100 shadow-sm">
              <div className="px-4 py-3 bg-brand-50/60 border-b border-brand-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-brand-900">All Investor Transactions</h3>
                  <p className="text-[11px] text-brand-600">
                    Chronological audit log of capital contributions and dividend payouts
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-brand-50/40 text-brand-700 font-semibold border-b border-brand-100">
                    <tr>
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5">Investor</th>
                      <th className="px-4 py-2.5">Type</th>
                      <th className="px-4 py-2.5 text-right">Amount</th>
                      <th className="px-4 py-2.5">Mode</th>
                      <th className="px-4 py-2.5">Reference</th>
                      <th className="px-4 py-2.5">Notes</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-50 text-brand-900">
                    {allTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-brand-400">
                          No transactions recorded yet.
                        </td>
                      </tr>
                    ) : (
                      allTransactions.map((tx) => (
                        <tr key={tx.id} className="hover:bg-brand-50/30 transition-colors">
                          <td className="px-4 py-3 font-mono">{formatDate(tx.date)}</td>
                          <td className="px-4 py-3 font-semibold text-brand-900">{tx.investorName}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                tx.type === 'INVESTMENT'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}
                            >
                              {tx.type}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-bold">
                            <span className={tx.type === 'INVESTMENT' ? 'text-emerald-700' : 'text-blue-700'}>
                              {formatCurrency(tx.amount)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-brand-700">{tx.paymentMode || '—'}</td>
                          <td className="px-4 py-3 text-brand-600 font-mono text-[11px]">
                            {tx.reference || '—'}
                          </td>
                          <td className="px-4 py-3 text-brand-600 max-w-xs truncate">{tx.notes || '—'}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => {
                                  const inv = investors?.find((i) => i.id === tx.investorId) || null;
                                  setTransactionInvestor(inv);
                                  setEditingTransaction(tx);
                                  setDefaultTxType(tx.type);
                                  setTransactionModalOpen(true);
                                }}
                                className="p-1 rounded text-brand-600 hover:text-brand-900 hover:bg-brand-50"
                                title="Edit Transaction"
                              >
                                ✏️
                              </button>
                              <button
                                onClick={() =>
                                  setConfirmDeleteTx({ id: tx.id, name: `${tx.type} - ${formatCurrency(tx.amount)}` })
                                }
                                className="p-1 rounded text-red-500 hover:text-red-700 hover:bg-red-50"
                                title="Delete Transaction"
                              >
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* MODAL 1: CREATE / EDIT INVESTOR */}
        {investorModalOpen && (
          <InvestorModal
            investor={editingInvestor}
            onClose={() => {
              setInvestorModalOpen(false);
              setEditingInvestor(null);
            }}
            onSaved={() => {
              setInvestorModalOpen(false);
              setEditingInvestor(null);
              refreshAll();
            }}
          />
        )}

        {/* MODAL 2: ADD / EDIT TRANSACTION */}
        {transactionModalOpen && transactionInvestor && (
          <TransactionModal
            investor={transactionInvestor}
            transaction={editingTransaction}
            defaultType={defaultTxType}
            onClose={() => {
              setTransactionModalOpen(false);
              setTransactionInvestor(null);
              setEditingTransaction(null);
            }}
            onSaved={() => {
              setTransactionModalOpen(false);
              setTransactionInvestor(null);
              setEditingTransaction(null);
              refreshAll();
            }}
          />
        )}

        {/* MODAL 3: QUICK PROFIT DISTRIBUTION MODAL */}
        {quickDistributeOpen && distributeTarget && (
          <QuickDistributeModal
            target={distributeTarget}
            periodRange={range}
            onClose={() => {
              setQuickDistributeOpen(false);
              setDistributeTarget(null);
            }}
            onSaved={() => {
              setQuickDistributeOpen(false);
              setDistributeTarget(null);
              refreshAll();
            }}
          />
        )}

        {/* MODAL 4: INVESTOR DETAIL & LEDGER STATEMENT */}
        {detailModalInvestor && (
          <InvestorDetailModal
            investor={detailModalInvestor}
            onClose={() => setDetailModalInvestor(null)}
            onDownloadPdf={() =>
              handleDownloadStatement(detailModalInvestor.id, detailModalInvestor.name)
            }
            onAddTransaction={(type) => {
              setTransactionInvestor(detailModalInvestor);
              setDefaultTxType(type);
              setEditingTransaction(null);
              setTransactionModalOpen(true);
            }}
            onEditTransaction={(tx) => {
              setTransactionInvestor(detailModalInvestor);
              setEditingTransaction(tx);
              setDefaultTxType(tx.type);
              setTransactionModalOpen(true);
            }}
            onDeleteTransaction={(tx) => {
              setConfirmDeleteTx({ id: tx.id, name: `${tx.type} - ${formatCurrency(tx.amount)}` });
            }}
          />
        )}

        {/* CONFIRM DELETE INVESTOR DIALOG */}
        {confirmDeleteInvestor && (
          <ConfirmDialog
            title="Delete / Deactivate Investor"
            message={`Are you sure you want to remove ${confirmDeleteInvestor.name}? If the investor has existing financial transactions, their account will be deactivated instead to preserve historical accounting records.`}
            confirmLabel="Confirm"
            danger
            onConfirm={handleDeleteInvestor}
            onCancel={() => setConfirmDeleteInvestor(null)}
          />
        )}

        {/* CONFIRM DELETE TRANSACTION DIALOG */}
        {confirmDeleteTx && (
          <ConfirmDialog
            title="Delete Transaction"
            message={`Are you sure you want to delete this transaction (${confirmDeleteTx.name})? This will immediately recalculate the investor's balance and ROI.`}
            confirmLabel="Delete"
            danger
            onConfirm={handleDeleteTransaction}
            onCancel={() => setConfirmDeleteTx(null)}
          />
        )}
      </div>
    </RoleGate>
  );
}

// -----------------------------------------------------------------------------
// MODAL: INVESTOR FORM (CREATE & EDIT)
// -----------------------------------------------------------------------------
function InvestorModal({
  investor,
  onClose,
  onSaved,
}: {
  investor: Investor | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(investor?.name || '');
  const [phone, setPhone] = useState(investor?.phone || '');
  const [email, setEmail] = useState(investor?.email || '');
  const [address, setAddress] = useState(investor?.address || '');
  const [panNumber, setPanNumber] = useState(investor?.panNumber || '');
  const [bankDetails, setBankDetails] = useState(investor?.bankDetails || '');
  const [sharePercentage, setSharePercentage] = useState(
    investor?.sharePercentage != null ? String(investor.sharePercentage) : '',
  );
  const [expectedRoi, setExpectedRoi] = useState(
    investor?.expectedRoi != null ? String(investor.expectedRoi) : '',
  );
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(investor?.status || 'ACTIVE');
  const [joinedDate, setJoinedDate] = useState(
    investor?.joinedDate ? investor.joinedDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState(investor?.notes || '');

  // Initial investment fields for new investor
  const [initialInvestment, setInitialInvestment] = useState('');
  const [initialPaymentMode, setInitialPaymentMode] = useState('BANK_TRANSFER');
  const [initialReference, setInitialReference] = useState('');

  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Investor name is required');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        panNumber: panNumber.trim() || undefined,
        bankDetails: bankDetails.trim() || undefined,
        sharePercentage: sharePercentage.trim() ? Number(sharePercentage) : undefined,
        expectedRoi: expectedRoi.trim() ? Number(expectedRoi) : undefined,
        status,
        joinedDate,
        notes: notes.trim() || undefined,
      };

      if (!investor && initialInvestment && Number(initialInvestment) > 0) {
        payload.initialInvestment = Number(initialInvestment);
        payload.initialPaymentMode = initialPaymentMode;
        payload.initialReference = initialReference.trim() || undefined;
      }

      if (investor) {
        await api.patch(`/investors/${investor.id}`, payload);
        toast.success('Investor updated successfully');
      } else {
        await api.post('/investors', payload);
        toast.success('Investor created successfully');
      }
      onSaved();
    } catch {
      // toast shown by apiFetch
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={investor ? `Edit Investor: ${investor.name}` : 'Add New Investor'} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Full Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Ramesh Kumar"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input w-full"
            />
          </div>

          <div>
            <label className="label">Phone Number</label>
            <input
              type="tel"
              placeholder="e.g. 9876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="input w-full"
            />
          </div>

          <div>
            <label className="label">Email Address</label>
            <input
              type="email"
              placeholder="e.g. ramesh@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input w-full"
            />
          </div>

          <div>
            <label className="label">PAN / Tax Identification</label>
            <input
              type="text"
              placeholder="e.g. ABCDE1234F"
              value={panNumber}
              onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
              className="input w-full uppercase"
            />
          </div>

          <div>
            <label className="label">
              Fixed Profit / Equity Share %{' '}
              <span className="text-brand-400 font-normal">(Leave blank for dynamic % based on capital)</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              placeholder="e.g. 15.00"
              value={sharePercentage}
              onChange={(e) => setSharePercentage(e.target.value)}
              className="input w-full"
            />
          </div>

          <div>
            <label className="label">Target Expected ROI % (Annual)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 18.00"
              value={expectedRoi}
              onChange={(e) => setExpectedRoi(e.target.value)}
              className="input w-full"
            />
          </div>

          <div>
            <label className="label">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
              className="input w-full"
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </div>

          <div>
            <label className="label">Joined Date</label>
            <input
              type="date"
              value={joinedDate}
              onChange={(e) => setJoinedDate(e.target.value)}
              className="input w-full"
            />
          </div>
        </div>

        <div>
          <label className="label">Bank Details / UPI Information</label>
          <input
            type="text"
            placeholder="e.g. HDFC A/C: 50100234567890 | IFSC: HDFC0001234 | UPI: ramesh@hdfc"
            value={bankDetails}
            onChange={(e) => setBankDetails(e.target.value)}
            className="input w-full"
          />
        </div>

        <div>
          <label className="label">Address / Location</label>
          <input
            type="text"
            placeholder="e.g. No. 42, Industrial Area, Bangalore"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="input w-full"
          />
        </div>

        {/* Optional Initial Capital for new investors */}
        {!investor && (
          <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-lg space-y-2">
            <p className="font-semibold text-emerald-900 text-xs">
              💰 Initial Capital Inflow (Optional)
            </p>
            <p className="text-[11px] text-emerald-700">
              Record their first capital contribution right now to establish their starting balance.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              <div>
                <label className="label text-emerald-900">Amount (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 500000"
                  value={initialInvestment}
                  onChange={(e) => setInitialInvestment(e.target.value)}
                  className="input w-full bg-white"
                />
              </div>

              <div>
                <label className="label text-emerald-900">Payment Mode</label>
                <select
                  value={initialPaymentMode}
                  onChange={(e) => setInitialPaymentMode(e.target.value)}
                  className="input w-full bg-white"
                >
                  {PAYMENT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label text-emerald-900">Reference / UTR</label>
                <input
                  type="text"
                  placeholder="e.g. UTR12345678"
                  value={initialReference}
                  onChange={(e) => setInitialReference(e.target.value)}
                  className="input w-full bg-white"
                />
              </div>
            </div>
          </div>
        )}

        <div>
          <label className="label">Terms &amp; Notes</label>
          <textarea
            rows={2}
            placeholder="Special partnership notes, agreed profit payout cadence, etc."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input w-full"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-brand-100">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : investor ? 'Update Investor' : 'Create Investor'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// MODAL: TRANSACTION FORM (CAPITAL IN OR PAYOUT OUT)
// -----------------------------------------------------------------------------
function TransactionModal({
  investor,
  transaction,
  defaultType,
  onClose,
  onSaved,
}: {
  investor: Investor;
  transaction: InvestorTransaction | null;
  defaultType: InvestorTransactionType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<InvestorTransactionType>(transaction?.type || defaultType);
  const [amount, setAmount] = useState(transaction?.amount != null ? String(transaction.amount) : '');
  const [date, setDate] = useState(
    transaction?.date ? transaction.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [paymentMode, setPaymentMode] = useState(transaction?.paymentMode || 'BANK_TRANSFER');
  const [reference, setReference] = useState(transaction?.reference || '');
  const [notes, setNotes] = useState(transaction?.notes || '');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) {
      toast.error('A valid positive amount is required');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        type,
        amount: Number(amount),
        date,
        paymentMode,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      };

      if (transaction) {
        await api.patch(`/investors/transactions/${transaction.id}`, payload);
        toast.success('Transaction updated');
      } else {
        await api.post(`/investors/${investor.id}/transactions`, payload);
        toast.success(
          type === 'INVESTMENT' ? 'Capital investment recorded' : 'Profit dividend payout recorded',
        );
      }
      onSaved();
    } catch {
      // toast shown by apiFetch
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={
        transaction
          ? `Edit Transaction (${investor.name})`
          : type === 'INVESTMENT'
          ? `Add Capital Investment (${investor.name})`
          : `Record Dividend / Payout (${investor.name})`
      }
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div>
          <label className="label">Transaction Type</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType('INVESTMENT')}
              className={`py-2 text-center rounded font-semibold border transition-all ${
                type === 'INVESTMENT'
                  ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-2xs'
                  : 'bg-white border-brand-200 text-brand-600'
              }`}
            >
              📥 Capital In (Investment)
            </button>
            <button
              type="button"
              onClick={() => setType('PAYOUT')}
              className={`py-2 text-center rounded font-semibold border transition-all ${
                type === 'PAYOUT'
                  ? 'bg-blue-50 border-blue-500 text-blue-800 shadow-2xs'
                  : 'bg-white border-brand-200 text-brand-600'
              }`}
            >
              📤 Dividend / Payout
            </button>
          </div>
        </div>

        <div>
          <label className="label">Amount (₹) *</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            required
            placeholder="e.g. 100000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input w-full text-base font-bold text-brand-900"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Date *</label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input w-full"
            />
          </div>

          <div>
            <label className="label">Payment Mode</label>
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value)}
              className="input w-full"
            >
              {PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Reference / Cheque / UTR No.</label>
          <input
            type="text"
            placeholder="e.g. UTR98765432 or Cheque #45210"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="input w-full"
          />
        </div>

        <div>
          <label className="label">Notes / Remarks</label>
          <textarea
            rows={2}
            placeholder="e.g. Q3 Profit dividend distribution"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input w-full"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-brand-100">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Record Transaction'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// MODAL: QUICK PROFIT DISTRIBUTION MODAL (FROM P&L TAB)
// -----------------------------------------------------------------------------
function QuickDistributeModal({
  target,
  periodRange,
  onClose,
  onSaved,
}: {
  target: InvestorPnlBreakdown;
  periodRange: { from?: string; to?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const suggestedAmount = target.balanceToDistribute > 0 ? target.balanceToDistribute : target.allocatedProfit;
  const [amount, setAmount] = useState(String(suggestedAmount > 0 ? suggestedAmount : 0));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMode, setPaymentMode] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState(
    `Profit Share Dividend${periodRange.from ? ` for period ${periodRange.from} to ${periodRange.to || 'today'}` : ''}`,
  );
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) {
      toast.error('A valid dividend amount is required');
      return;
    }

    setSaving(true);
    try {
      await api.post('/investors/distribute-profit', {
        investorId: target.id,
        amount: Number(amount),
        date,
        paymentMode,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        periodFrom: periodRange.from,
        periodTo: periodRange.to,
      });

      toast.success(`Dividend payout of ${formatCurrency(Number(amount))} recorded for ${target.name}`);
      onSaved();
    } catch {
      // toast shown by apiFetch
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Distribute Profit Dividend: ${target.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div className="p-3 bg-brand-50/70 border border-brand-200 rounded-lg space-y-1.5">
          <div className="flex justify-between">
            <span className="text-brand-600">Calculated Profit Share:</span>
            <strong className="text-emerald-700">{formatCurrency(target.allocatedProfit)}</strong>
          </div>
          <div className="flex justify-between">
            <span className="text-brand-600">Already Paid in Period:</span>
            <span className="font-semibold">{formatCurrency(target.payoutsInPeriod)}</span>
          </div>
          <div className="flex justify-between border-t border-brand-200 pt-1">
            <span className="text-brand-800 font-semibold">Remaining Balance to Pay:</span>
            <strong className="text-amber-700">{formatCurrency(target.balanceToDistribute)}</strong>
          </div>
        </div>

        <div>
          <label className="label">Dividend Payout Amount (₹) *</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input w-full text-base font-bold text-brand-900"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Payment Date *</label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input w-full"
            />
          </div>

          <div>
            <label className="label">Payment Mode</label>
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value)}
              className="input w-full"
            >
              {PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Transaction Reference / UTR</label>
          <input
            type="text"
            placeholder="e.g. UTR45681029"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="input w-full"
          />
        </div>

        <div>
          <label className="label">Remarks</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input w-full"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-brand-100">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Recording...' : 'Confirm & Record Dividend'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// MODAL: INVESTOR DETAIL & LEDGER STATEMENT MODAL
// -----------------------------------------------------------------------------
function InvestorDetailModal({
  investor,
  onClose,
  onDownloadPdf,
  onAddTransaction,
  onEditTransaction,
  onDeleteTransaction,
}: {
  investor: Investor;
  onClose: () => void;
  onDownloadPdf: () => void;
  onAddTransaction: (type: InvestorTransactionType) => void;
  onEditTransaction: (tx: InvestorTransaction) => void;
  onDeleteTransaction: (tx: InvestorTransaction) => void;
}) {
  const { data: fullInvestor } = useSWR<Investor>(`/investors/${investor.id}`, fetcher, {
    fallbackData: investor,
  });

  const inv = fullInvestor || investor;

  return (
    <Modal title={`Investor Ledger: ${inv.name}`} onClose={onClose} wide>
      <div className="space-y-4 text-xs">
        {/* Profile Card */}
        <div className="p-3 bg-brand-50/50 border border-brand-100 rounded-lg flex flex-col sm:flex-row justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-brand-900">{inv.name}</h3>
            <p className="text-brand-600">
              Joined {formatDate(inv.joinedDate)} &middot; Status:{' '}
              <span className="font-semibold">{inv.status}</span>
            </p>
            {inv.phone && <p className="text-brand-700">Phone: {inv.phone}</p>}
            {inv.email && <p className="text-brand-700">Email: {inv.email}</p>}
            {inv.panNumber && (
              <p className="text-brand-700 uppercase font-mono">PAN: {inv.panNumber}</p>
            )}
            {inv.bankDetails && (
              <p className="text-brand-800 font-medium">Bank/UPI: {inv.bankDetails}</p>
            )}
          </div>

          <div className="flex flex-col sm:items-end justify-between gap-2">
            <button
              onClick={onDownloadPdf}
              className="btn-secondary text-xs flex items-center gap-1.5 shadow-2xs"
            >
              <span>📄</span>
              <span>Download PDF Statement</span>
            </button>

            <div className="flex gap-2">
              <button
                onClick={() => onAddTransaction('INVESTMENT')}
                className="btn-primary text-xs py-1 px-2.5 bg-emerald-700 hover:bg-emerald-800"
              >
                + Capital
              </button>
              <button
                onClick={() => onAddTransaction('PAYOUT')}
                className="btn-primary text-xs py-1 px-2.5 bg-blue-700 hover:bg-blue-800"
              >
                💸 Payout
              </button>
            </div>
          </div>
        </div>

        {/* Financial Stat Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded">
            <p className="text-[10px] text-emerald-800 uppercase font-semibold">Total Invested</p>
            <p className="text-base font-bold text-emerald-800 mt-0.5">
              {formatCurrency(inv.totalInvested)}
            </p>
          </div>
          <div className="p-2.5 bg-blue-50/70 border border-blue-200 rounded">
            <p className="text-[10px] text-blue-800 uppercase font-semibold">Total Returns</p>
            <p className="text-base font-bold text-blue-800 mt-0.5">
              {formatCurrency(inv.totalPayouts)}
            </p>
          </div>
          <div className="p-2.5 bg-brand-50 border border-brand-200 rounded">
            <p className="text-[10px] text-brand-700 uppercase font-semibold">Current Capital</p>
            <p className="text-base font-bold text-brand-900 mt-0.5">
              {formatCurrency(inv.currentBalance)}
            </p>
          </div>
          <div className="p-2.5 bg-purple-50/70 border border-purple-200 rounded">
            <p className="text-[10px] text-purple-800 uppercase font-semibold">Return on Investment</p>
            <p className="text-base font-bold text-purple-900 mt-0.5">{inv.roi}%</p>
          </div>
        </div>

        {/* Transactions Table */}
        <div className="border border-brand-100 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-brand-50/60 border-b border-brand-100 font-bold text-brand-900">
            Transaction History ({inv.transactions?.length || 0})
          </div>

          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-brand-50/40 text-brand-700 font-semibold border-b border-brand-100 sticky top-0">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Notes</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-50 text-brand-900">
                {!inv.transactions || inv.transactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-brand-400">
                      No transactions recorded for this investor yet.
                    </td>
                  </tr>
                ) : (
                  inv.transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-brand-50/30 transition-colors">
                      <td className="px-3 py-2 font-mono">{formatDate(tx.date)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            tx.type === 'INVESTMENT'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {tx.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-bold">
                        <span className={tx.type === 'INVESTMENT' ? 'text-emerald-700' : 'text-blue-700'}>
                          {formatCurrency(tx.amount)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-brand-700">{tx.paymentMode || '—'}</td>
                      <td className="px-3 py-2 text-brand-600 font-mono text-[10px]">
                        {tx.reference || '—'}
                      </td>
                      <td className="px-3 py-2 text-brand-600 max-w-xs truncate">{tx.notes || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onEditTransaction(tx)}
                            className="p-1 rounded text-brand-600 hover:text-brand-900 hover:bg-brand-50"
                            title="Edit"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => onDeleteTransaction(tx)}
                            className="p-1 rounded text-red-500 hover:text-red-700 hover:bg-red-50"
                            title="Delete"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-brand-100">
          <button type="button" onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

