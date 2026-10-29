'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { ImportButton } from '@/components/ImportButton';

// Main view tabs
type MainTab = 'overview' | 'overall' | 'category' | 'settings' | 'reports';

function ExpensesContent() {
  const [tab, setTab] = useState<MainTab>('overview');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch all active categories dynamically (no restrictive scope filters!)
  const { data: rawCategories } = useSWR<ExpenseCategory[]>('/expense-config/categories', fetcher);

  // All active categories (includes both COMPANY and PERSONAL like EMI)
  const categories = useMemo(() => {
    return (rawCategories ?? [])
      .filter((c) => c.isActive !== false)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rawCategories]);

  // Set initial selected category once categories load
  useEffect(() => {
    if (!selectedCategoryId && categories.length > 0) {
      setSelectedCategoryId(categories[0].id);
    }
  }, [categories, selectedCategoryId]);

  // Click outside listener for category dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setCategoryDropdownOpen(false);
      }
    }
    if (categoryDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [categoryDropdownOpen]);

  const activeCategory = categories.find((c) => c.id === selectedCategoryId) || categories[0];

  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return categories;
    const q = categorySearch.toLowerCase().trim();
    return categories.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.scope?.toLowerCase().includes(q) ||
        c.defaultReferenceType?.code?.toLowerCase().includes(q),
    );
  }, [categories, categorySearch]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Expenses</h1>
          <p className="text-sm text-brand-500 mt-1">
            Company financial control center - every rupee going out, where it went, and who paid it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ImportButton kind="expenses" className="btn-secondary text-sm" />
          <button className="btn-primary text-sm shadow-xs" onClick={() => setAddOpen(true)}>
            + Add Expense
          </button>
        </div>
      </div>

      {/* Consolidated Top Navigation Bar */}
      <div className="flex items-center gap-1 border-b border-brand-200 overflow-visible">
        {/* Main View 1: Overview */}
        <button
          onClick={() => {
            setTab('overview');
            setCategoryDropdownOpen(false);
          }}
          className={`px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
            tab === 'overview'
              ? 'border-brand-700 text-brand-900 font-semibold'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          Overview
        </button>

        {/* Main View 2: Overall */}
        <button
          onClick={() => {
            setTab('overall');
            setCategoryDropdownOpen(false);
          }}
          className={`px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
            tab === 'overall'
              ? 'border-brand-700 text-brand-900 font-semibold'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          Overall
        </button>

        {/* Main View 3: Categories / Expense Entry Dropdown Selector */}
        <div className="relative inline-block" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => {
              if (tab !== 'category') {
                setTab('category');
              }
              setCategoryDropdownOpen((prev) => !prev);
            }}
            className={`px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors flex items-center gap-2 ${
              tab === 'category'
                ? 'border-brand-700 text-brand-900 font-semibold bg-brand-50/50'
                : 'border-transparent text-ink-muted hover:text-ink hover:bg-brand-50/30'
            }`}
          >
            <span>📁</span>
            <span>
              {activeCategory && tab === 'category'
                ? `Category: ${activeCategory.name}`
                : 'Categories / Expense Entry'}
            </span>
            {activeCategory && tab === 'category' && (
              <span
                className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                  activeCategory.scope === 'PERSONAL'
                    ? 'bg-purple-100 text-purple-700'
                    : 'bg-blue-100 text-blue-700'
                }`}
              >
                {activeCategory.scope ?? 'COMPANY'}
              </span>
            )}
            <span className="text-xs text-brand-500">▾</span>
          </button>

          {/* Vertical Select Menu for Categories */}
          {categoryDropdownOpen && (
            <div className="absolute left-0 top-full mt-1.5 w-72 sm:w-80 bg-white rounded-xl shadow-xl border border-brand-200 z-50 py-2 overflow-hidden animate-in fade-in duration-150">
              <div className="px-3 pb-2 border-b border-brand-100">
                <input
                  type="text"
                  placeholder="Search categories (e.g. EMI)..."
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  className="input w-full text-xs py-1.5 px-2.5"
                  autoFocus
                />
              </div>

              <div className="max-h-80 overflow-y-auto py-1 divide-y divide-brand-50">
                <div className="px-3 py-1 bg-brand-50/50 flex items-center justify-between text-[10px] font-bold text-brand-500 uppercase tracking-wider">
                  <span>Active Expense Categories</span>
                  <span>{filteredCategories.length} available</span>
                </div>

                {filteredCategories.length === 0 ? (
                  <p className="px-4 py-5 text-xs text-brand-400 text-center">
                    No categories found matching &quot;{categorySearch}&quot;
                  </p>
                ) : (
                  filteredCategories.map((c) => {
                    const isSelected = activeCategory?.id === c.id && tab === 'category';
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedCategoryId(c.id);
                          setTab('category');
                          setCategoryDropdownOpen(false);
                          setCategorySearch('');
                        }}
                        className={`w-full text-left px-3.5 py-2.5 text-xs flex items-center justify-between transition-colors ${
                          isSelected
                            ? 'bg-brand-100/70 text-brand-900 font-bold'
                            : 'text-brand-800 hover:bg-brand-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm shrink-0">
                            {c.scope === 'PERSONAL' ? '🏠' : '🏢'}
                          </span>
                          <span className="truncate">{c.name}</span>
                          {c.defaultReferenceType && (
                            <span className="text-[10px] text-brand-400 font-mono shrink-0">
                              [{c.defaultReferenceType.code}]
                            </span>
                          )}
                        </div>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                            c.scope === 'PERSONAL'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {c.scope ?? 'COMPANY'}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Main View 4: Settings */}
        <button
          onClick={() => {
            setTab('settings');
            setCategoryDropdownOpen(false);
          }}
          className={`px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
            tab === 'settings'
              ? 'border-brand-700 text-brand-900 font-semibold'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          Settings
        </button>

        {/* Main View 5: Reports */}
        <button
          onClick={() => {
            setTab('reports');
            setCategoryDropdownOpen(false);
          }}
          className={`px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
            tab === 'reports'
              ? 'border-brand-700 text-brand-900 font-semibold'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          Reports
        </button>
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'overall' && (
        <ExpenseListTab
          title="Overall Outgoing"
          description="Every outgoing transaction, unified."
          exportName="expenses-overall"
          onCreate={() => setAddOpen(true)}
        />
      )}
      {tab === 'category' && activeCategory && (
        <div className="space-y-4">
          <div className="card p-3 bg-brand-50/60 border border-brand-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-brand-700">Active Category:</span>
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="input text-xs py-1.5 px-2.5 font-bold text-brand-900 bg-white border border-brand-300 rounded-md"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.scope === 'PERSONAL' ? '🏠 ' : '🏢 '}
                    {c.name} [{c.scope ?? 'COMPANY'}]
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setAddOpen(true)}
                className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1 shadow-xs"
              >
                <span>+</span>
                <span>Add Entry to {activeCategory.name}</span>
              </button>
            </div>
          </div>

          <ExpenseListTab
            key={activeCategory.id}
            title={activeCategory.name}
            description={`Transactions categorized as ${activeCategory.name}${
              activeCategory.scope === 'PERSONAL'
                ? ' (Personal Expense - isolated from company operational totals)'
                : ''
            }.`}
            categoryId={activeCategory.id}
            exportName={`expenses-${activeCategory.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
            onCreate={() => setAddOpen(true)}
          />
        </div>
      )}
      {tab === 'settings' && <ExpenseSettingsTab />}
      {tab === 'reports' && <ReportsTab />}

      {addOpen && (
        <ExpenseFormModal
          editing={null}
          defaultCategoryId={tab === 'category' ? activeCategory?.id : undefined}
          defaultScope={tab === 'category' ? (activeCategory?.scope ?? 'COMPANY') : undefined}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
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
        'V': e.voucherNumber ?? '',
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
