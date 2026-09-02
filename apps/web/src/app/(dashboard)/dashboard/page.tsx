'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { StatCard } from '@/components/StatCard';
import { formatCurrency } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';
import type { DashboardSummary } from '@/types';

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading } = useSWR<DashboardSummary>('/dashboard/summary', fetcher);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">Welcome back, {user?.name?.split(' ')[0]}</h1>
        <p className="text-brand-500 text-sm mt-1">Here&apos;s what&apos;s happening across the business today.</p>
      </div>

      {isLoading || !data ? (
        <p className="text-brand-400 text-sm">Loading summary...</p>
      ) : (
        <>
          <section>
            <h2 className="text-sm font-semibold text-brand-700 uppercase tracking-wide mb-3">Customer Orders</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total Orders" value={String(data.customerOrders.count)} />
              <StatCard label="Pending Delivery" value={String(data.customerOrders.pending)} accent="warning" />
              <StatCard label="Delivered" value={String(data.customerOrders.delivered)} accent="success" />
              <StatCard label="Outstanding Balance" value={formatCurrency(data.customerOrders.totalBalance)} accent="warning" />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-brand-700 uppercase tracking-wide mb-3">Party Orders</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total Orders" value={String(data.partyOrders.count)} />
              <StatCard label="Pending Delivery" value={String(data.partyOrders.pending)} accent="warning" />
              <StatCard label="Delivered" value={String(data.partyOrders.delivered)} accent="success" />
              <StatCard label="Outstanding Balance" value={formatCurrency(data.partyOrders.totalBalance)} accent="warning" />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-brand-700 uppercase tracking-wide mb-3">Suppliers</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Suppliers" value={String(data.suppliers.count)} />
              <StatCard label="Total Purchases" value={formatCurrency(data.suppliers.totalPurchaseValue)} />
              <StatCard label="Total Paid" value={formatCurrency(data.suppliers.totalPaid)} accent="success" />
              <StatCard label="Payable Balance" value={formatCurrency(data.suppliers.totalBalance)} accent="warning" />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-brand-700 uppercase tracking-wide mb-3">Carpenters</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Carpenters" value={String(data.carpenters.count)} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
