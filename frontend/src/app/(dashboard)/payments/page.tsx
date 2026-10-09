'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { getAccessToken } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { StatCard } from '@/components/StatCard';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { RoleGate } from '@/components/RoleGate';
import { PaymentDetailModal } from '@/components/PaymentDetailModal';
import { Pagination } from '@/components/Pagination';
import type { PaymentSource, UnifiedPaymentsResponse } from '@/types';
import { ImportButton } from '@/components/ImportButton';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const SOURCE_TABS: { value: '' | PaymentSource; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'CUSTOMER_ORDER', label: 'Customer Orders' },
  { value: 'PARTY_ORDER', label: 'Party Orders' },
  { value: 'SUPPLIER', label: 'Suppliers' },
  { value: 'CARPENTER', label: 'Carpenters' },
  { value: 'EXPENSE', label: 'Expenses' },
];

const SOURCE_LABEL: Record<PaymentSource, string> = {
  CUSTOMER_ORDER: 'Customer Order',
  PARTY_ORDER: 'Party Order',
  SUPPLIER: 'Supplier',
  CARPENTER: 'Carpenter',
  EXPENSE: 'Expense',
};

const SOURCE_CHIP: Record<PaymentSource, ChipColor> = {
  CUSTOMER_ORDER: 'green',
  PARTY_ORDER: 'blue',
  SUPPLIER: 'amber',
  CARPENTER: 'gray',
  EXPENSE: 'gray',
};

function PaymentsContent() {
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mode, setMode] = useState('');
  const [category, setCategory] = useState('');
  const { data: categories } = useSWR<{ id: string; name: string }[]>('/expense-config/categories', fetcher);
  const { data: paymentModes } = useSWR<{ id: string; name: string }[]>('/expense-config/payment-modes', fetcher);
  const filtersActive = Boolean(source || search || from || to || mode || category);
  const [detailTarget, setDetailTarget] = useState<{ source: PaymentSource; relatedId: string } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const queryParams = new URLSearchParams({
    ...(source ? { source } : {}),
    ...(search ? { search } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(mode ? { mode } : {}),
    ...(category ? { category } : {}),
  });
  const { data, isLoading } = useSWR<UnifiedPaymentsResponse>(`/payments?${queryParams}`, fetcher);
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [source, search, from, to, mode, category]);
  const allRows = data?.payments ?? [];
  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const pageRows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${API_BASE_URL}/payments/pdf?${queryParams}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payments-statement-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Payments</h1>
          <p className="text-sm text-brand-500 mt-1">Money received from customers and parties, and money paid to suppliers, carpenters and for expenses.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ImportButton kind="payments" />
          <button className="btn-secondary" onClick={downloadPdf} disabled={downloading}>
            {downloading ? 'Preparing...' : 'Download PDF'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Money Received" value={formatCurrency(data?.totalIn ?? 0)} accent="success" sub="From customers and party orders" />
        <StatCard label="Money Paid" value={formatCurrency(data?.totalOut ?? 0)} accent="warning" sub="To suppliers, carpenters and expenses" />
        <StatCard label="Balance" value={formatCurrency(data?.net ?? 0)} sub="Received minus paid" />
      </div>

      <div className="flex gap-1 border-b border-brand-200 overflow-x-auto">
        {SOURCE_TABS.map((t) => (
          <button
            key={t.label}
            onClick={() => setSource(t.value)}
            className={`px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              source === t.value ? 'border-brand-700 text-brand-900' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Search
          <input className="input max-w-xs" placeholder="Name, shop, supplier or carpenter" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Payment mode
          <select className="input max-w-[180px]" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="">All payment modes</option>
          {(paymentModes ?? []).map((m) => (
            <option key={m.id} value={m.name}>{m.name}</option>
          ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Expense category
          <select className="input max-w-[200px]" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All expense categories</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          From date
          <input type="date" className="input max-w-[160px]" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          To date
          <input type="date" className="input max-w-[160px]" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={!filtersActive}
          onClick={() => { setSearch(''); setSource(''); setFrom(''); setTo(''); setMode(''); setCategory(''); }}
        >
          Clear filters
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>Date</th>
              <th>Source</th>
              <th>Party</th>
              <th>Direction</th>
              <th>Amount</th>
              <th>Mode</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-brand-400">
                  Loading payments...
                </td>
              </tr>
            )}
            {!isLoading && allRows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-brand-400">
                  No payments found
                </td>
              </tr>
            )}
            {pageRows.map((p) => (
              <tr
                key={`${p.source}-${p.id}`}
                className="cursor-pointer hover:bg-brand-50"
                onClick={() => setDetailTarget({ source: p.source, relatedId: p.relatedId })}
              >
                <td>{formatDate(p.date)}</td>
                <td>
                  <Chip color={SOURCE_CHIP[p.source]} label={SOURCE_LABEL[p.source]} />
                </td>
                <td>{p.relatedName}</td>
                <td className={p.direction === 'IN' ? 'text-emerald-600' : 'text-red-600'}>{p.direction === 'IN' ? 'In' : 'Out'}</td>
                <td className="font-medium">{formatCurrency(p.amount)}</td>
                <td>{p.mode ?? '-'}</td>
                <td className="text-brand-500 max-w-[220px] truncate">{p.note ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {allRows.length > PAGE_SIZE && (
          <Pagination page={page} totalPages={totalPages} total={allRows.length} limit={PAGE_SIZE} onPageChange={setPage} />
        )}
      </div>

      {detailTarget && (
        <PaymentDetailModal source={detailTarget.source} relatedId={detailTarget.relatedId} onClose={() => setDetailTarget(null)} />
      )}
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <RoleGate minRole="SUPERADMIN">
      <PaymentsContent />
    </RoleGate>
  );
}
