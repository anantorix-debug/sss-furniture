'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { formatCurrency, formatDate } from '@/lib/format';
import { StatCard } from '@/components/StatCard';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { RoleGate } from '@/components/RoleGate';
import type { PaymentSource, UnifiedPaymentsResponse } from '@/types';

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

  const { data, isLoading } = useSWR<UnifiedPaymentsResponse>(
    `/payments?${new URLSearchParams({ ...(source ? { source } : {}), ...(search ? { search } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })}`,
    fetcher,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">Payments</h1>
        <p className="text-sm text-brand-500 mt-1">All customer, party, supplier and carpenter payments in one place.</p>
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
              <tr key={`${p.source}-${p.id}`}>
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
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <RoleGate minRole="ADMIN">
      <PaymentsContent />
    </RoleGate>
  );
}
