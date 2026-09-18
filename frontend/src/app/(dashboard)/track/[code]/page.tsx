'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { ApiError, getAccessToken } from '@/lib/api';
import { Chip, StatusBadge, type ChipColor } from '@/components/StatusBadge';
import { StatCard } from '@/components/StatCard';
import { InlineLoader } from '@/components/PageLoader';
import { formatCurrency, formatDate } from '@/lib/format';
import type { TrackResult, TrackWorkItem } from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const STAGE_ORDER = ['CARPENTER', 'CARVING', 'POLISH'] as const;
const STAGE_LABEL: Record<string, string> = { CARPENTER: 'Carpenter', CARVING: 'Carving', POLISH: 'Polishing' };
const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  QUALITY_CHECK: 'Quality Check',
  REWORK: 'Rework',
  COMPLETED: 'Completed',
};
function statusChipColor(status: string): ChipColor {
  if (status === 'COMPLETED') return 'green';
  if (status === 'REWORK') return 'red';
  return 'amber';
}

export default function TrackPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const decoded = decodeURIComponent(code);
  const { data, isLoading, error, mutate } = useSWR<TrackResult>(`/search/track?q=${encodeURIComponent(decoded)}`, fetcher);
  const [downloading, setDownloading] = useState(false);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${API_BASE_URL}/search/track/pdf?q=${encodeURIComponent(decoded)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Track - ${decoded}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  const stages: { stage: string; items: TrackWorkItem[] }[] = STAGE_ORDER.map((stage) => ({
    stage,
    items: (data?.workItems ?? []).filter((w) => w.stage === stage),
  })).filter((s) => s.items.length > 0);
  // Any stage type not in the known three (future production stages) still
  // shows up rather than being silently dropped.
  const otherStages = Array.from(new Set((data?.workItems ?? []).map((w) => w.stage).filter((s) => !(STAGE_ORDER as readonly string[]).includes(s))));
  for (const stage of otherStages) {
    stages.push({ stage, items: (data?.workItems ?? []).filter((w) => w.stage === stage) });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button className="text-sm text-brand-500 hover:underline mb-2" onClick={() => router.back()}>
            &larr; Back
          </button>
          <h1 className="text-2xl font-bold text-brand-900">Model No &ldquo;{decoded}&rdquo;</h1>
          <p className="text-sm text-brand-500 mt-1">Complete order &rarr; production &rarr; employee &rarr; delivery history for this Model No.</p>
        </div>
        <button className="btn-secondary" onClick={downloadPdf} disabled={downloading}>
          {downloading ? 'Preparing...' : 'Download PDF'}
        </button>
      </div>

      {isLoading && <InlineLoader label="Searching..." />}
      {error && (
        <div className="card p-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-red-600">{error instanceof ApiError ? error.message : 'Failed to search. Please try again.'}</p>
          <button className="btn-secondary h-8 px-3 text-xs" onClick={() => mutate()}>
            Retry
          </button>
        </div>
      )}

      {data && !data.found && (
        <div className="card p-8 text-center text-brand-400">No order, product, or production record found for Model No &ldquo;{decoded}&rdquo;.</div>
      )}

      {data?.product && (
        <div className="card p-5">
          <h2 className="font-semibold text-brand-900 mb-3">Product Master</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Model No" value={data.product.modelNo ?? '-'} />
            <StatCard label="Name" value={data.product.name} />
            <StatCard label="Category" value={data.product.category ?? '-'} />
            <StatCard label="Size" value={data.product.modelSize ?? '-'} />
            <StatCard label="Finish" value={data.product.materialFinish ?? '-'} />
            <StatCard label="Unit" value={data.product.unit ?? '-'} />
            {data.product.retailPrice !== undefined && <StatCard label="Retail Price" value={formatCurrency(data.product.retailPrice)} />}
            <StatCard label="Status" value={data.product.isActive ? 'Active' : 'Inactive'} />
          </div>
        </div>
      )}

      {data && data.customerOrders.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-semibold text-brand-900">
            Customer Order{data.customerOrders.length > 1 ? `s (${data.customerOrders.length})` : ''}
          </h2>
          {data.customerOrders.map((order) => (
            <div key={order.id} className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <StatusBadge status={order.deliveryStatus} />
                  <Chip color={order.paymentStatus === 'SETTLED' ? 'green' : 'red'} label={order.paymentStatus === 'SETTLED' ? 'Paid' : 'Payment Due'} />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Order ID" value={order.orderId} />
                <StatCard label="Customer" value={order.customerName} />
                <StatCard label="Phone" value={order.phone ?? '-'} />
                <StatCard label="Product" value={order.product} />
                <StatCard label="Order Date" value={formatDate(order.orderDate)} />
                <StatCard label="Expected Delivery" value={formatDate(order.expectedDeliveryDate)} />
                {order.orderValue !== undefined && <StatCard label="Order Value" value={formatCurrency(order.orderValue)} />}
                {order.balanceAmount !== undefined && <StatCard label="Balance" value={formatCurrency(order.balanceAmount)} />}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-brand-100">
                <StatCard label="Assigned Employee" value={order.assignedEmployee ?? 'Unassigned'} />
                <StatCard label="Model No Updated By" value={order.modelNoUpdatedBy ?? '-'} />
                <StatCard label="Model No Updated At" value={order.modelNoUpdatedAt ? formatDate(order.modelNoUpdatedAt) : '-'} />
              </div>
              {order.specialInstructions && (
                <p className="text-sm text-brand-600 mt-3">
                  <strong>Special Instructions:</strong> {order.specialInstructions}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {data && data.partyOrders.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-semibold text-brand-900">Party Order{data.partyOrders.length > 1 ? `s (${data.partyOrders.length})` : ''}</h2>
          {data.partyOrders.map((order) => (
            <div key={order.id} className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <StatusBadge status={order.deliveryStatus} />
                  <Chip color={order.paymentStatus === 'SETTLED' ? 'green' : 'red'} label={order.paymentStatus === 'SETTLED' ? 'Paid' : 'Payment Due'} />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Shop" value={order.shopName} />
                <StatCard label="Phone" value={order.phone ?? '-'} />
                <StatCard label="Product" value={order.model} />
                <StatCard label="Finish" value={order.finish ?? '-'} />
                <StatCard label="Qty" value={String(order.qty)} />
                <StatCard label="Order Date" value={formatDate(order.orderDate)} />
                {order.totalAmount !== undefined && <StatCard label="Total Amount" value={formatCurrency(order.totalAmount)} />}
                {order.balanceAmount !== undefined && <StatCard label="Balance" value={formatCurrency(order.balanceAmount)} />}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-brand-100">
                <StatCard label="Assigned Employee" value={order.assignedEmployee ?? 'Unassigned'} />
                <StatCard label="Model No Updated By" value={order.modelNoUpdatedBy ?? '-'} />
                <StatCard label="Model No Updated At" value={order.modelNoUpdatedAt ? formatDate(order.modelNoUpdatedAt) : '-'} />
              </div>
            </div>
          ))}
        </div>
      )}

      {data && data.partyOrderItems.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-semibold text-brand-900">
            Party Order Line{data.partyOrderItems.length > 1 ? `s (${data.partyOrderItems.length})` : ''}
          </h2>
          {data.partyOrderItems.map((item) => (
            <div key={item.id} className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <StatusBadge status={item.deliveryStatus} />
                  <Chip color={item.paymentStatus === 'SETTLED' ? 'green' : 'red'} label={item.paymentStatus === 'SETTLED' ? 'Paid' : 'Payment Due'} />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Shop" value={item.shopName} />
                <StatCard label="Phone" value={item.phone ?? '-'} />
                <StatCard label="Product" value={item.productName} />
                <StatCard label="Finish" value={item.finish ?? '-'} />
                <StatCard label="Qty" value={String(item.qty)} />
                <StatCard label="From Stock" value={String(item.stockReservedQty)} />
                <StatCard label="From Production" value={String(item.productionQty)} />
                <StatCard label="Order Date" value={formatDate(item.orderDate)} />
                {item.totalValue !== undefined && <StatCard label="Line Total" value={formatCurrency(item.totalValue)} />}
                {item.balanceAmount !== undefined && <StatCard label="Order Balance" value={formatCurrency(item.balanceAmount)} />}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-brand-100">
                <StatCard label="Model No Updated By" value={item.modelNoUpdatedBy ?? '-'} />
                <StatCard label="Model No Updated At" value={item.modelNoUpdatedAt ? formatDate(item.modelNoUpdatedAt) : '-'} />
                <StatCard label="Created By" value={item.createdBy ?? '-'} />
              </div>
            </div>
          ))}
        </div>
      )}

      {stages.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-semibold text-brand-900">Production Details &amp; Employee History</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {stages.map(({ stage, items }) => (
              <div key={stage} className="card p-5">
                <h3 className="font-semibold text-brand-800 mb-3">{STAGE_LABEL[stage] ?? stage}</h3>
                <div className="space-y-3">
                  {items.map((w) => (
                    <div key={w.id} className="border-t border-brand-100 pt-3 first:border-0 first:pt-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-ink">{w.carpenter?.name ?? 'Unassigned'}</p>
                        <Chip color={statusChipColor(w.status)} label={STATUS_LABEL[w.status] ?? w.status} />
                      </div>
                      <div className="text-xs text-brand-500 mt-1 space-y-0.5">
                        <p>Assigned: {formatDate(w.assignedDate)}</p>
                        <p>Completed: {w.completedDate ? formatDate(w.completedDate) : '-'}</p>
                        {w.total !== undefined && <p>Work Value: {formatCurrency(w.total)}</p>}
                      </div>
                      {w.qcNote && <p className="text-xs text-brand-600 mt-1">QC Note: {w.qcNote}</p>}
                      {w.materials.length > 0 && (
                        <div className="mt-2">
                          <p className="text-[11px] font-medium text-ink-muted mb-1">Materials &amp; Supplier</p>
                          <div className="space-y-1">
                            {w.materials.map((m) => (
                              <p key={m.id} className="text-xs text-brand-500">
                                {m.rawMaterialName} &middot; {m.quantityIssued} {m.unit}
                                {m.purchaseHistory[0]?.supplierName ? ` — from ${m.purchaseHistory[0].supplierName}` : ''}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
