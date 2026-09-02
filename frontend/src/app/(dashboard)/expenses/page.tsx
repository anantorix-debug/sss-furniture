'use client';

import { useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { fetcher } from '@/lib/swr';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { StatCard } from '@/components/StatCard';
import { RoleGate } from '@/components/RoleGate';
import { ExpenseListTab } from '@/components/ExpenseListTab';
import { ExpenseSettingsTab } from '@/components/ExpenseSettingsTab';
import { ExpenseFormModal } from '@/components/ExpenseFormModal';
import { downloadCsv } from '@/lib/csv';
import { formatDate } from '@/lib/format';
import type { ExpenseSummary, ExpenseMonthly, ExpenseCategory, Expense } from '@/types';

// Fixed tabs that always exist, plus one dynamically-generated tab per
// active expense category (so a category created in Settings - "petty
// cash", or any future one - shows up here immediately with no code
// change). "Personal Expense" stays a separate scope-filtered tab rather
// than a category tab, even though a "Personal Expense" category also
// exists, to avoid showing the same data under two tabs.
type FixedTab = 'overview' | 'overall' | 'personal' | 'settings' | 'reports';
type Tab = FixedTab | string; // non-fixed values are ExpenseCategory ids

function ExpensesContent() {
  const [tab, setTab] = useState<Tab>('overview');
  const [addOpen, setAddOpen] = useState(false);
  const { data: categories } = useSWR<ExpenseCategory[]>('/expense-config/categories', fetcher);

  const categoryTabs = (categories ?? []).filter((c) => c.scope !== 'PERSONAL');
  const activeCategory = categoryTabs.find((c) => c.id === tab);

  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'overall', label: 'Overall' },
    ...categoryTabs.map((c) => ({ value: c.id, label: c.name })),
    { value: 'personal', label: 'Personal Expense' },
    { value: 'settings', label: 'Settings' },
    { value: 'reports', label: 'Reports' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Expenses</h1>
          <p className="text-sm text-brand-500 mt-1">Company financial control center - every rupee going out, where it went, and who paid it.</p>
        </div>
        <button className="btn-primary text-sm" onClick={() => setAddOpen(true)}>
          + Add Expense
        </button>
      </div>

      <div className="flex gap-1 border-b border-brand-200 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t.value ? 'border-brand-700 text-brand-900' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'overall' && <ExpenseListTab title="Overall Outgoing" description="Every outgoing transaction, unified." exportName="expenses-overall" onCreate={() => setAddOpen(true)} />}
      {tab === 'personal' && (
        <ExpenseListTab
          title="Personal Expense"
          description="Super Admin's private tracking - never counted in company totals."
          scope="PERSONAL"
          exportName="expenses-personal"
          onCreate={() => setAddOpen(true)}
        />
      )}
      {activeCategory && (
        <ExpenseListTab
          title={activeCategory.name}
          description={`Transactions categorized as ${activeCategory.name}.`}
          categoryId={activeCategory.id}
          exportName={`expenses-${activeCategory.name.toLowerCase().replace(/[^a-z]+/g, '-')}`}
          onCreate={() => setAddOpen(true)}
        />
      )}
      {tab === 'settings' && <ExpenseSettingsTab />}
      {tab === 'reports' && <ReportsTab />}

      {addOpen && (
        <ExpenseFormModal
          editing={null}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            // Whichever list tab is active reads its own /expenses?... SWR
            // key - revalidate every key under that prefix so the new entry
            // shows up without needing to know which tab is on screen.
            globalMutate((key) => typeof key === 'string' && key.startsWith('/expenses'));
          }}
        />
      )}
    </div>
  );
}

function OverviewTab() {
  const { data: summary } = useSWR<ExpenseSummary>('/expenses/summary', fetcher);

  if (!summary) return <p className="text-brand-400 text-sm">Loading summary...</p>;

  const maxCategory = Math.max(1, ...summary.byCategory.map((c) => c.total));
  const maxMode = Math.max(1, ...summary.byPaymentMode.map((m) => m.total));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Outgoing" value={formatCurrency(summary.overallTotal)} />
        <StatCard label="Company Expenses" value={formatCurrency(summary.companyTotal)} accent="default" />
        <StatCard label="Personal Expenses" value={formatCurrency(summary.personalTotal)} accent="warning" />
        <StatCard label="This Month" value={formatCurrency(summary.thisMonth)} accent="success" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Today" value={formatCurrency(summary.today)} />
        <StatCard label="This Week" value={formatCurrency(summary.thisWeek)} />
        <StatCard label="This Month" value={formatCurrency(summary.thisMonth)} />
        <StatCard label="This Year" value={formatCurrency(summary.thisYear)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="font-semibold text-brand-900 mb-4">Category Breakdown</h3>
          <div className="space-y-3">
            {summary.byCategory.length === 0 && <p className="text-sm text-brand-400">No expenses recorded yet.</p>}
            {summary.byCategory.map((c) => (
              <div key={c.categoryId}>
                <div className="flex justify-between text-xs text-brand-600 mb-1">
                  <span>{c.categoryName}</span>
                  <span className="font-medium">{formatCurrency(c.total)}</span>
                </div>
                <div className="h-2 bg-brand-50 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-600 rounded-full" style={{ width: `${(c.total / maxCategory) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-semibold text-brand-900 mb-4">Payment Mode Breakdown</h3>
          <div className="space-y-3">
            {summary.byPaymentMode.length === 0 && <p className="text-sm text-brand-400">No expenses recorded yet.</p>}
            {summary.byPaymentMode.map((m) => (
              <div key={m.paymentModeId}>
                <div className="flex justify-between text-xs text-brand-600 mb-1">
                  <span>{m.paymentModeName}</span>
                  <span className="font-medium">{formatCurrency(m.total)}</span>
                </div>
                <div className="h-2 bg-emerald-50 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${(m.total / maxMode) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ReportsTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { data: monthly } = useSWR<ExpenseMonthly>(`/expenses/monthly?year=${year}&month=${month}`, fetcher);
  const { data: categories } = useSWR<ExpenseCategory[]>('/expense-config/categories', fetcher);

  async function exportReport(label: string, categoryId?: string, scope?: 'COMPANY' | 'PERSONAL') {
    const params = new URLSearchParams({ ...(categoryId ? { categoryId } : {}), ...(scope ? { scope } : {}) });
    const result = await api.get<{ data: Expense[] }>(`/expenses?${params}`);
    downloadCsv(
      `expenses-report-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      result.data.map((e) => ({
        'S.No': e.voucherNumber,
        Date: formatDate(e.date),
        Ref: e.referenceType?.code ?? '',
        Category: e.category.name,
        Particulars: e.particulars,
        Mode: e.paymentMode.name,
        Debit: e.amount,
        Type: e.scope,
        'Paid By': e.paidBy ?? '',
      })),
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="font-semibold text-brand-900">Monthly Report</h3>
          <div className="flex gap-2">
            <select className="input" value={month} onChange={(e) => setMonth(parseInt(e.target.value, 10))}>
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <select className="input" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))}>
              {[year - 1, year, year + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        {monthly && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label={`${MONTH_NAMES[month - 1]} ${year} Total`} value={formatCurrency(monthly.total)} />
            <StatCard label="Company" value={formatCurrency(monthly.company)} />
            <StatCard label="Personal" value={formatCurrency(monthly.personal)} accent="warning" />
            <StatCard label="Categories" value={String(monthly.byCategory.length)} />
          </div>
        )}

        {monthly && monthly.byCategory.length > 0 && (
          <div className="mt-4 space-y-2">
            {monthly.byCategory.map((c) => (
              <div key={c.categoryId} className="flex justify-between text-sm border-b border-brand-50 py-1.5">
                <span className="text-brand-600">{c.categoryName}</span>
                <span className="font-medium">{formatCurrency(c.total)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-5">
        <h3 className="font-semibold text-brand-900 mb-3">Quick Exports (CSV)</h3>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary text-sm" onClick={() => exportReport('Overall')}>
            Overall Outgoing
          </button>
          <button className="btn-secondary text-sm" onClick={() => exportReport('Company', undefined, 'COMPANY')}>
            Company Expense
          </button>
          <button className="btn-secondary text-sm" onClick={() => exportReport('Personal', undefined, 'PERSONAL')}>
            Personal Expense
          </button>
          {categories?.map((c) => (
            <button key={c.id} className="btn-secondary text-sm" onClick={() => exportReport(c.name, c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        <p className="text-xs text-brand-400 mt-3">Excel and PDF export are not yet available - CSV opens directly in Excel/Sheets.</p>
      </div>
    </div>
  );
}

export default function ExpensesPage() {
  return (
    <RoleGate minRole="SUPERADMIN">
      <ExpensesContent />
    </RoleGate>
  );
}
