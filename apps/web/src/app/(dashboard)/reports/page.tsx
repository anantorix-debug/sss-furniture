'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { getAccessToken } from '@/lib/api';
import { RoleGate } from '@/components/RoleGate';
import { StatCard } from '@/components/StatCard';
import { InlineLoader } from '@/components/PageLoader';
import { StatusBadge } from '@/components/StatusBadge';
import { formatCurrency, formatDate } from '@/lib/format';
import type { ProfitAndLoss, SalesReport } from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

function ReportsContent() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [channel, setChannel] = useState<'ALL' | 'CUSTOMER' | 'PARTY'>('ALL');

  const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), channel });
  const { data: sales, isLoading: salesLoading } = useSWR<SalesReport>(`/reports/sales?${qs}`, fetcher);
  const { data: pnl, isLoading: pnlLoading } = useSWR<ProfitAndLoss>(`/reports/profit-loss?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`, fetcher);

  async function exportCsv() {
    const token = getAccessToken();
    const res = await fetch(`${API_BASE_URL}/reports/sales/export?${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sales-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Reports</h1>
          <p className="text-sm text-brand-500 mt-1">Sales report and profit &amp; loss, filterable by date range.</p>
        </div>
        <button className="btn-secondary" onClick={exportCsv}>
          Export Sales CSV
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <input type="date" className="input max-w-[160px]" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="input max-w-[160px]" value={to} onChange={(e) => setTo(e.target.value)} />
        <select className="input max-w-[160px]" value={channel} onChange={(e) => setChannel(e.target.value as 'ALL' | 'CUSTOMER' | 'PARTY')}>
          <option value="ALL">All channels</option>
          <option value="CUSTOMER">Retail only</option>
          <option value="PARTY">Wholesale only</option>
        </select>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-brand-700 uppercase tracking-wide">Profit &amp; Loss</h2>
        {pnlLoading || !pnl ? (
          <InlineLoader />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Revenue (Retail)" value={formatCurrency(pnl.revenue.retail)} />
            <StatCard label="Revenue (Wholesale)" value={formatCurrency(pnl.revenue.wholesale)} />
            <StatCard label="Material + Labour Cost" value={formatCurrency(pnl.costs.total)} accent="warning" />
            <StatCard label="Profit" value={formatCurrency(pnl.profit)} accent={pnl.profit >= 0 ? 'success' : 'warning'} />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-brand-700 uppercase tracking-wide">Sales Report</h2>
        {sales && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
            <StatCard label="Orders" value={String(sales.count)} />
            <StatCard label="Total Value" value={formatCurrency(sales.totalValue)} />
            <StatCard label="Outstanding" value={formatCurrency(sales.totalBalance)} accent="warning" />
          </div>
        )}
        <div className="card overflow-x-auto">
          <table className="table-shell">
            <thead>
              <tr>
                <th>Date</th>
                <th>Channel</th>
                <th>Reference</th>
                <th>Party</th>
                <th>Value</th>
                <th>Received</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {salesLoading && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-brand-400">
                    Loading report...
                  </td>
                </tr>
              )}
              {!salesLoading && sales?.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-brand-400">
                    No orders in this range
                  </td>
                </tr>
              )}
              {sales?.rows.map((r, idx) => (
                <tr key={idx}>
                  <td>{formatDate(r.date)}</td>
                  <td>{r.channel}</td>
                  <td className="font-medium">{r.reference}</td>
                  <td>{r.party}</td>
                  <td>{formatCurrency(r.value)}</td>
                  <td>{formatCurrency(r.received)}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <RoleGate minRole="ADMIN">
      <ReportsContent />
    </RoleGate>
  );
}
