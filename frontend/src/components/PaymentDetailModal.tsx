'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { fetcher } from '@/lib/swr';
import { formatCurrency, formatDate } from '@/lib/format';
import { Modal } from '@/components/Modal';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import type { PaymentSource, CustomerOrder, PartyOrder, SupplierDetail, CarpenterDetail } from '@/types';

const SOURCE_ENDPOINT: Record<PaymentSource, string> = {
  CUSTOMER_ORDER: '/customer-orders',
  PARTY_ORDER: '/party-orders',
  SUPPLIER: '/suppliers',
  CARPENTER: '/carpenters',
};

const SOURCE_LINK: Record<PaymentSource, string> = {
  CUSTOMER_ORDER: '/customer-orders',
  PARTY_ORDER: '/party-orders',
  SUPPLIER: '/suppliers',
  CARPENTER: '/carpenters',
};

// Clicking a payment row opens this - fetches the full record behind that
// one payment (the order, supplier, or carpenter it belongs to) so "why was
// this ₹15,000 paid" is answerable without leaving the Payments page.
export function PaymentDetailModal({ source, relatedId, onClose }: { source: PaymentSource; relatedId: string; onClose: () => void }) {
  const { data, isLoading } = useSWR<CustomerOrder | PartyOrder | SupplierDetail | CarpenterDetail>(
    `${SOURCE_ENDPOINT[source]}/${relatedId}`,
    fetcher,
  );

  return (
    <Modal title="Payment Source Details" onClose={onClose} wide>
      {isLoading && <p className="text-brand-400 text-sm">Loading...</p>}
      {!isLoading && !data && <p className="text-brand-400 text-sm">Record not found - it may have been deleted.</p>}
      {!isLoading && data && source === 'CUSTOMER_ORDER' && <CustomerOrderDetail order={data as CustomerOrder} />}
      {!isLoading && data && source === 'PARTY_ORDER' && <PartyOrderDetail order={data as PartyOrder} />}
      {!isLoading && data && source === 'SUPPLIER' && <SupplierDetailView supplier={data as SupplierDetail} />}
      {!isLoading && data && source === 'CARPENTER' && <CarpenterDetailView carpenter={data as CarpenterDetail} />}
      {!isLoading && data && (
        <div className="mt-4 pt-3 border-t border-brand-100 text-right">
          <Link href={SOURCE_LINK[source]} className="text-xs text-brand-600 hover:underline" onClick={onClose}>
            Open full {source === 'CUSTOMER_ORDER' ? 'Customer Orders' : source === 'PARTY_ORDER' ? 'Party Orders' : source === 'SUPPLIER' ? 'Suppliers' : 'Production'} page &rarr;
          </Link>
        </div>
      )}
    </Modal>
  );
}

function PaymentHistory({ payments }: { payments?: { id: string; date: string; amount: number; mode?: string | null; note?: string | null; voucherNo?: string | null }[] }) {
  if (!payments || payments.length === 0) return <p className="text-sm text-brand-400">No payments recorded.</p>;
  return (
    <div className="max-h-48 overflow-y-auto rounded-lg border border-brand-100">
      <table className="table-shell">
        <thead>
          <tr>
            <th>Date</th>
            <th>Amount</th>
            <th>Mode</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td>{formatDate(p.date)}</td>
              <td className="font-medium">{formatCurrency(p.amount)}</td>
              <td>{p.mode ?? '-'}</td>
              <td className="text-brand-500">{p.note ?? p.voucherNo ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomerOrderDetail({ order }: { order: CustomerOrder }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-brand-900">{order.orderId} - {order.customerName}</p>
          <p className="text-sm text-brand-500">{order.product}{order.phone ? ` · ${order.phone}` : ''}</p>
        </div>
        <StatusBadge status={order.deliveryStatus} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Order Value" value={formatCurrency(order.orderValue ?? 0)} />
        <StatCard label="Received" value={formatCurrency(order.totalReceived ?? 0)} accent="success" />
        <StatCard label="Balance" value={formatCurrency(order.balanceAmount ?? 0)} accent={((order.balanceAmount ?? 0) > 0) ? 'warning' : 'default'} />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-brand-900 mb-2">Payment History</h3>
        <PaymentHistory payments={order.payments} />
      </div>
    </div>
  );
}

function PartyOrderDetail({ order }: { order: PartyOrder }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-brand-900">{order.shopName}</p>
          <p className="text-sm text-brand-500">{order.model}{order.phone ? ` · ${order.phone}` : ''} · Qty {order.qty}</p>
        </div>
        <StatusBadge status={order.deliveryStatus} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Amount" value={formatCurrency(order.totalAmount ?? 0)} />
        <StatCard label="Received" value={formatCurrency(order.receivedAmount ?? 0)} accent="success" />
        <StatCard label="Balance" value={formatCurrency(order.balanceAmount ?? 0)} accent={((order.balanceAmount ?? 0) > 0) ? 'warning' : 'default'} />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-brand-900 mb-2">Payment History</h3>
        <PaymentHistory payments={order.payments} />
      </div>
    </div>
  );
}

function SupplierDetailView({ supplier }: { supplier: SupplierDetail }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="font-semibold text-brand-900">{supplier.name}</p>
        {supplier.phone && <p className="text-sm text-brand-500">{supplier.phone}</p>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Purchases" value={formatCurrency(supplier.totalPurchaseValue)} />
        <StatCard label="Total Paid" value={formatCurrency(supplier.totalPaid)} accent="success" />
        <StatCard label="Balance Payable" value={formatCurrency(supplier.balance)} accent={supplier.balance > 0 ? 'warning' : 'default'} />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-brand-900 mb-2">Recent Purchases</h3>
        <div className="max-h-40 overflow-y-auto rounded-lg border border-brand-100">
          <table className="table-shell">
            <thead>
              <tr>
                <th>Date</th>
                <th>Particulars</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {supplier.purchases.length === 0 && (
                <tr><td colSpan={3} className="text-center text-brand-400 py-3">No purchases recorded</td></tr>
              )}
              {supplier.purchases.slice(-10).reverse().map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.date)}</td>
                  <td>{p.particulars}</td>
                  <td className="font-medium">{formatCurrency(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-brand-900 mb-2">Payment History</h3>
        <PaymentHistory payments={supplier.payments} />
      </div>
    </div>
  );
}

function CarpenterDetailView({ carpenter }: { carpenter: CarpenterDetail }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="font-semibold text-brand-900">{carpenter.name}</p>
        {carpenter.phone && <p className="text-sm text-brand-500">{carpenter.phone}</p>}
      </div>
      {carpenter.totalWorkValue !== undefined && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total Work Value" value={formatCurrency(carpenter.totalWorkValue)} />
          <StatCard label="Total Paid" value={formatCurrency(carpenter.totalPaid ?? 0)} accent="success" />
          <StatCard label="Balance Payable" value={formatCurrency(carpenter.balance ?? 0)} accent={(carpenter.balance ?? 0) > 0 ? 'warning' : 'default'} />
        </div>
      )}
      <div>
        <h3 className="text-sm font-semibold text-brand-900 mb-2">Work Items ({carpenter.workItems.length})</h3>
        <div className="max-h-40 overflow-y-auto rounded-lg border border-brand-100">
          <table className="table-shell">
            <thead>
              <tr>
                <th>Date</th>
                <th>Product</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {carpenter.workItems.length === 0 && (
                <tr><td colSpan={3} className="text-center text-brand-400 py-3">No work items yet</td></tr>
              )}
              {carpenter.workItems.slice(-10).reverse().map((w) => (
                <tr key={w.id}>
                  <td>{formatDate(w.workDate)}</td>
                  <td>{w.productName}</td>
                  <td className="text-brand-500">{w.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-brand-900 mb-2">Payment History</h3>
        <PaymentHistory payments={carpenter.payments} />
      </div>
    </div>
  );
}
