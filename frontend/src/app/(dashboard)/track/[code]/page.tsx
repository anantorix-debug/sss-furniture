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
          <h1 className="text-2xl font-bold text-brand-900">Search Record &ldquo;{decoded}&rdquo;</h1>
          <p className="text-sm text-brand-500 mt-1">Complete order &rarr; voucher &rarr; production &rarr; employee &rarr; delivery history for &ldquo;{decoded}&rdquo;.</p>
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

      {data && data.customerOrderItems.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-semibold text-brand-900">
            Customer Order Line{data.customerOrderItems.length > 1 ? `s (${data.customerOrderItems.length})` : ''}
          </h2>
          {data.customerOrderItems.map((item) => (
            <div key={item.id} className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <StatusBadge status={item.deliveryStatus} />
                  <Chip color={item.paymentStatus === 'SETTLED' ? 'green' : 'red'} label={item.paymentStatus === 'SETTLED' ? 'Paid' : 'Payment Due'} />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Order ID" value={item.orderIdLabel} />
                <StatCard label="Customer" value={item.customerName} />
                <StatCard label="Phone" value={item.phone ?? '-'} />
                <StatCard label="Product" value={item.productName} />
                <StatCard label="Category" value={item.category ?? '-'} />
                <StatCard label="Size" value={item.size ?? '-'} />
                <StatCard label="Qty" value={String(item.quantity)} />
                <StatCard label="From Stock" value={String(item.stockReservedQty)} />
                <StatCard label="From Production" value={String(item.productionQty)} />
                <StatCard label="Order Date" value={formatDate(item.orderDate)} />
                {item.unitPrice !== undefined && <StatCard label="Unit Price" value={formatCurrency(item.unitPrice)} />}
                {item.balanceAmount !== undefined && <StatCard label="Order Balance" value={formatCurrency(item.balanceAmount)} />}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-brand-100">
                <StatCard label="Model No Set By" value={item.modelNoSetBy ?? '-'} />
                <StatCard label="Model No Set At" value={item.modelNoSetAt ? formatDate(item.modelNoSetAt) : '-'} />
                <StatCard label="Created By" value={item.createdBy ?? '-'} />
              </div>
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

      {/* Expense Vouchers */}
      {data && data.expenses && data.expenses.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-semibold text-brand-900">
            Matching Expense Voucher{data.expenses.length > 1 ? `s (${data.expenses.length})` : ''}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.expenses.map((e) => (
              <div key={e.id} className="card p-5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-mono font-bold text-xs bg-brand-100 text-brand-800 px-2.5 py-0.5 rounded">
                    {e.voucherNumber ? `VOUCHER #${e.voucherNumber}` : (e.reference ? `REF: ${e.reference}` : 'EXPENSE VOUCHER')}
                  </span>
                  <span className="text-xs text-brand-500">{formatDate(e.date)}</span>
                </div>
                <p className="font-semibold text-brand-900 text-base">{e.particulars}</p>
                <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-brand-100 text-xs">
                  <div>
                    <span className="text-brand-400">Category:</span>
                    <p className="font-medium text-brand-800">{e.categoryName} [{e.categoryScope ?? 'COMPANY'}]</p>
                  </div>
                  <div>
                    <span className="text-brand-400">Amount:</span>
                    <p className="font-bold text-brand-900 text-sm">{formatCurrency(e.amount)}</p>
                  </div>
                  <div>
                    <span className="text-brand-400">Payment Mode:</span>
                    <p className="font-medium text-brand-700">{e.paymentMode ?? '—'}</p>
                  </div>
                  <div>
                    <span className="text-brand-400">Recorded By:</span>
                    <p className="font-medium text-brand-700">{e.createdBy}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Carpenter Payment Vouchers */}
      {data && data.carpenterPayments && data.carpenterPayments.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-semibold text-brand-900">
            Matching Worker / Payment Voucher{data.carpenterPayments.length > 1 ? `s (${data.carpenterPayments.length})` : ''}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.carpenterPayments.map((p) => (
              <div key={p.id} className="card p-5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-mono font-bold text-xs bg-amber-100 text-amber-900 px-2.5 py-0.5 rounded">
                    {p.voucherNo ? `VOUCHER #${p.voucherNo}` : (p.reference ? `REF: ${p.reference}` : 'PAYMENT')}
                  </span>
                  <span className="text-xs text-brand-500">{formatDate(p.date)}</span>
                </div>
                <p className="font-semibold text-brand-900 text-base">{p.carpenterName}</p>
                <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-brand-100 text-xs">
                  <div>
                    <span className="text-brand-400">Worker Phone:</span>
                    <p className="font-medium text-brand-800">{p.carpenterPhone ?? '—'}</p>
                  </div>
                  <div>
                    <span className="text-brand-400">Amount Paid:</span>
                    <p className="font-bold text-emerald-700 text-sm">{formatCurrency(p.amount)}</p>
                  </div>
                  <div>
                    <span className="text-brand-400">Mode:</span>
                    <p className="font-medium text-brand-700">{p.mode ?? '—'}</p>
                  </div>
                  <div>
                    <span className="text-brand-400">Payment Type:</span>
                    <p className="font-medium text-brand-700">{p.paymentType}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Purchase Orders */}
      {data && data.purchaseOrders && data.purchaseOrders.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-semibold text-brand-900">
            Matching Purchase Order{data.purchaseOrders.length > 1 ? `s (${data.purchaseOrders.length})` : ''}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.purchaseOrders.map((po) => (
              <div key={po.id} className="card p-5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-mono font-bold text-xs bg-blue-100 text-blue-900 px-2.5 py-0.5 rounded">
                    PO #{po.purchaseNumber}
                  </span>
                  <span className="text-xs text-brand-500">{formatDate(po.date)}</span>
                </div>
                <p className="font-semibold text-brand-900 text-base">{po.supplierName}</p>
                <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-brand-100 text-xs">
                  <div>
                    <span className="text-brand-400">Invoice:</span>
                    <p className="font-medium text-brand-800">{po.invoiceNumber ?? '—'}</p>
                  </div>
                  {po.totalAmount !== undefined && (
                    <div>
                      <span className="text-brand-400">Total:</span>
                      <p className="font-bold text-brand-900 text-sm">{formatCurrency(po.totalAmount)}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-brand-400">Status:</span>
                    <p className="font-medium text-brand-700">{po.status}</p>
                  </div>
                  <div>
                    <span className="text-brand-400">Supplier Phone:</span>
                    <p className="font-medium text-brand-700">{po.supplierPhone ?? '—'}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
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
                        <p>Work Started: {w.startedAt ? formatDate(w.startedAt) : 'Not started yet'}</p>
                        <p>Work Finished: {w.finishedAt ? formatDate(w.finishedAt) : w.status === 'IN_PROGRESS' ? 'In progress' : 'Pending'}</p>
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
