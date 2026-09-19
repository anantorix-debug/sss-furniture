'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, getAccessToken } from '@/lib/api';
import { RoleGate } from '@/components/RoleGate';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { PurchaseFormModal } from '@/components/PurchaseFormModal';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import { formatCurrency, formatDate } from '@/lib/format';
import { PURCHASE_STATUS_LABEL } from '@/types';
import type { Purchase, PurchaseStatus, SupplierSummary } from '@/types';
import { Pagination, type PaginatedResult } from '@/components/Pagination';
import { FilterBar } from '@/components/FilterBar';
import { PurchasingTabs } from '@/components/PurchasingTabs';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const emptyFilters: Record<string, string> = {};
const STATUS_OPTIONS = Object.entries(PURCHASE_STATUS_LABEL).map(([value, label]) => ({ value, label }));

const STATUS_CHIP: Record<PurchaseStatus, ChipColor> = {
  PENDING_APPROVAL: 'amber',
  APPROVED: 'blue',
  RECORDED: 'green',
  CANCELLED: 'red',
};

// Shows material + quantity, not just a count, so the list is useful at a
// glance - matching the same "name +N more" pattern already used by Party
// Orders' list for its own multi-line summary.
function itemsSummary(purchase: Purchase): string {
  if (purchase.items.length === 0) return '-';
  const first = purchase.items[0];
  const pieces = first.pieces != null ? `, ${first.pieces} pcs` : '';
  const firstText = `${first.rawMaterial?.name ?? 'Material'} (${first.quantity} ${first.rawMaterial?.unit ?? ''}${pieces})`;
  return purchase.items.length === 1 ? firstText : `${firstText} +${purchase.items.length - 1} more`;
}

function PurchaseOrdersContent() {
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  const [values, setValues] = useState<Record<string, string>>(emptyFilters);
  const [applied, setApplied] = useState<Record<string, string>>(emptyFilters);
  const [downloading, setDownloading] = useState(false);
  const { data: suppliers } = useSWR<SupplierSummary[]>('/suppliers', fetcher);
  const queryParams = new URLSearchParams({ ...applied, page: String(page), limit: '20' });
  const { data: result, isLoading, mutate } = useSWR<PaginatedResult<Purchase>>(`/purchase-orders?${queryParams}`, fetcher);
  const data = result?.data;

  function applyFilters() {
    setApplied(values);
    setPage(1);
  }
  function resetFilters() {
    setValues(emptyFilters);
    setApplied(emptyFilters);
    setPage(1);
  }

  async function downloadPdf() {
    setDownloading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${API_BASE_URL}/purchase-orders/pdf?${new URLSearchParams(applied)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `purchases-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  const {
    showModal,
    whatsappOptions,
    openWhatsApp,
    closeWhatsApp,
  } = useWhatsApp();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Purchase | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Deep-linked from a raw material's "Record a Purchase" button - opens
  // the New Purchase form with that material pre-selected on the first
  // line (the supplier is still left for the admin to pick).
  const materialIdParam = searchParams.get('materialId');
  const [handledMaterialParam, setHandledMaterialParam] = useState(false);
  if (materialIdParam && !handledMaterialParam) {
    setHandledMaterialParam(true);
    setEditing(null);
    setFormOpen(true);
  }

  // Deep-linked from the purchase detail page's "Edit" button - opens the
  // edit form for that one purchase, same shape as the materialId deep-link
  // above, so the edit form only needs to exist in one place.
  const editIdParam = searchParams.get('edit');
  const { data: editTarget } = useSWR<Purchase>(editIdParam ? `/purchase-orders/${editIdParam}` : null, fetcher);
  const [handledEditParam, setHandledEditParam] = useState(false);
  if (editIdParam && !handledEditParam && editTarget) {
    setHandledEditParam(true);
    setEditing(editTarget);
    setFormOpen(true);
  }

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(purchase: Purchase) {
    setEditing(purchase);
    setFormOpen(true);
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await api.post(`/purchase-orders/${cancelTarget.id}/cancel`);
      setCancelTarget(null);
      mutate();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Failed to cancel purchase');
      setCancelTarget(null);
    } finally {
      setCancelling(false);
    }
  }

  function handleSendWhatsApp(purchase: Purchase) {
    openWhatsApp({
      recipientName: (purchase.supplier?.name ?? '') || 'Supplier',
      recipientPhone: purchase.supplier?.phone ?? undefined,
      defaultMessage: `Purchase ${purchase.purchaseNumber}\nTotal: ₹${purchase.totalValue}`,
    });
  }

  return (
    <div className="space-y-6">
      <PurchasingTabs active="purchase-orders" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Purchase Orders</h1>
          <p className="text-sm text-brand-500 mt-1">
            Needs a Super Admin&apos;s approval to update the supplier&apos;s balance payable, then a &quot;Mark as Received&quot; once the
            material actually arrives to update stock.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={downloadPdf} disabled={downloading}>
            {downloading ? 'Preparing...' : 'Download PDF'}
          </button>
          <button className="btn-primary" onClick={openCreate}>
            + New Purchase
          </button>
        </div>
      </div>

      <FilterBar
        fields={[
          { key: 'search', label: 'Search', type: 'search', placeholder: 'Search purchase no. / supplier...' },
          { key: 'supplierId', label: 'Supplier', type: 'select', options: (suppliers ?? []).map((s) => ({ value: s.id, label: s.name })) },
          { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
        ]}
        values={values}
        onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
        onApply={applyFilters}
        onReset={resetFilters}
      />

      {notice && <p className="text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">{notice}</p>}

      <div className="card overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>Purchase No</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Items</th>
              <th>Total</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-brand-400">
                  Loading purchases...
                </td>
              </tr>
            )}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-brand-400">
                  No purchases yet
                </td>
              </tr>
            )}
            {data?.map((purchase) => (
              <tr key={purchase.id}>
                <td className="font-medium">{purchase.purchaseNumber}</td>
                <td>{formatDate(purchase.purchaseDate)}</td>
                <td>{purchase.supplier?.name}</td>
                <td>{itemsSummary(purchase)}</td>
                <td className="font-medium">{formatCurrency(purchase.totalValue)}</td>
                <td>
                  <Chip color={STATUS_CHIP[purchase.status]} label={PURCHASE_STATUS_LABEL[purchase.status]} />
                </td>
                <td className="space-x-2 whitespace-nowrap">
                  <Link href={`/purchase-orders/${purchase.id}`} className="btn-secondary h-7 px-3 text-xs inline-flex">
                    View
                  </Link>
                  <WhatsAppActionButton
                    recipientName={(purchase.supplier?.name ?? '') || 'Supplier'}
                    recipientPhone={purchase.supplier?.phone ?? undefined}
                    onClick={() => handleSendWhatsApp(purchase)}
                    size="sm"
                  />
                  {purchase.status !== 'CANCELLED' && (
                    <>
                      <button className="text-brand-600 hover:underline text-xs" onClick={() => openEdit(purchase)}>
                        Edit
                      </button>
                      <button
                        className="text-red-600 hover:underline text-xs"
                        onClick={() => setCancelTarget(purchase)}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {result && (
          <Pagination page={result.page} totalPages={result.totalPages} total={result.total} limit={result.limit} onPageChange={setPage} />
        )}
      </div>

      {formOpen && (
        <PurchaseFormModal
          editing={editing}
          initialMaterialId={materialIdParam ?? undefined}
          onClose={() => setFormOpen(false)}
          onSaved={() => mutate()}
        />
      )}

      {cancelTarget && (
        <ConfirmDialog
          title="Cancel Purchase"
          message={`Cancel ${cancelTarget.purchaseNumber}? This reverses its stock and supplier balance impact. This cannot be undone.`}
          confirmLabel={cancelling ? 'Cancelling...' : 'Cancel Purchase'}
          danger
          onConfirm={handleCancel}
          onCancel={() => setCancelTarget(null)}
        />
      )}

      {showModal && whatsappOptions && (
        <WhatsAppModal
          onClose={closeWhatsApp}
          recipientInfo={{
            name: whatsappOptions.recipientName,
            phone: whatsappOptions.recipientPhone,
          }}
          defaultMessage={whatsappOptions.defaultMessage}
          onSuccess={() => mutate()}
        />
      )}
    </div>
  );
}

export default function PurchaseOrdersPage() {
  return (
    <RoleGate minRole="ADMIN">
      <PurchaseOrdersContent />
    </RoleGate>
  );
}
