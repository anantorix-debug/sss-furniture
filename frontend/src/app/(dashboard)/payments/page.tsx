'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { getAccessToken } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { StatCard } from '@/components/StatCard';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { RoleGate } from '@/components/RoleGate';
import { PaymentDetailModal } from '@/components/PaymentDetailModal';
import type { PaymentSource, UnifiedPaymentsResponse } from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const SOURCE_LABEL: Record<PaymentSource, string> = {
  CUSTOMER_ORDER: 'Customer Order',
  PARTY_ORDER: 'Party Order',
  SUPPLIER: 'Supplier',
  CARPENTER: 'Carpenter',
};

const SOURCE_CHIP: Record<PaymentSource, ChipColor> = {
  CUSTOMER_ORDER: 'green',
  PARTY_ORDER: 'blue',
  SUPPLIER: 'amber',
  CARPENTER: 'gray',
};

function PaymentsContent() {
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detailTarget, setDetailTarget] = useState<{ source: PaymentSource; relatedId: string } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const queryParams = new URLSearchParams({
    ...(source ? { source } : {}),
    ...(search ? { search } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const { data, isLoading } = useSWR<UnifiedPaymentsResponse>(`/payments?${queryParams}`, fetcher);

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
          <p className="text-sm text-brand-500 mt-1">All customer, party, supplier and carpenter payments in one place.</p>
        </div>
        <button className="btn-secondary" onClick={downloadPdf} disabled={downloading}>
          {downloading ? 'Preparing...' : 'Download PDF'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Money In" value={formatCurrency(data?.totalIn ?? 0)} accent="success" sub="Customer + Party" />
        <StatCard label="Money Out" value={formatCurrency(data?.totalOut ?? 0)} accent="warning" sub="Supplier + Carpenter" />
        <StatCard label="Net" value={formatCurrency(data?.net ?? 0)} />
      </div>

      <div className="flex flex-wrap gap-3">
        <input className="input max-w-xs" placeholder="Search customer, shop, supplier, carpenter..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[180px]" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          <option value="CUSTOMER_ORDER">Customer Orders</option>
          <option value="PARTY_ORDER">Party Orders</option>
          <option value="SUPPLIER">Suppliers</option>
          <option value="CARPENTER">Carpenters</option>
        </select>
        <input type="date" className="input max-w-[160px]" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="input max-w-[160px]" value={to} onChange={(e) => setTo(e.target.value)} />
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
            {!isLoading && data?.payments.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-brand-400">
                  No payments found
                </td>
              </tr>
            )}
            {data?.payments.map((p) => (
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
