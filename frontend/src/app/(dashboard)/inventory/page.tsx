'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ViewField } from '@/components/ViewField';
import { StatCard } from '@/components/StatCard';
import { Chip } from '@/components/StatusBadge';
import { UnitSelect } from '@/components/UnitSelect';
import { downloadCsv } from '@/lib/csv';
import { assetUrl, uploadGalleryImage, validateProductImageFile, getAccessToken } from '@/lib/api';
import { GalleryGrid } from '@/components/GalleryGrid';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import { FilterBar } from '@/components/FilterBar';
import type { CarpenterSummary, GalleryImage, MaterialGroup, MaterialMeasurementKind, Product, ProductStockMovement, RawMaterial, StockMovement, WorkerType } from '@/types';
import { Pagination, type PaginatedResult } from '@/components/Pagination';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type Tab = 'products' | 'materials' | 'movements' | 'stock-movements' | 'gallery';

const emptyProductForm = {
  modelNo: '',
  sku: '',
  name: '',
  category: '',
  modelSize: '',
  materialFinish: '',
  sizeUnit: '',
  pattern: '',
  details: '',
  unit: '',
  retailPrice: '',
  wholesalePrice: '',
  costPrice: '',
};

// Every row here becomes exactly one physical piece in stock - there is no
// quantity field, matching the rest of Stock Management (one Model No =
// one piece, never a count).
interface BulkProductRow {
  modelNo: string;
  name: string;
  category: string;
  finish: string;
  size: string;
  retailPrice: string;
}

const emptyBulkRow: BulkProductRow = {
  modelNo: '',
  name: '',
  category: '',
  finish: '',
  size: '',
  retailPrice: '',
};

const MATERIAL_GROUP_LABEL: Record<MaterialGroup, string> = {
  WOOD: 'Carpenter Team',
  CARVING: 'Carving Team',
  POLISH: 'Polish Team',
  OTHER: 'Other / Shared',
};

const emptyMaterialForm = { name: '', type: '', unit: '', reorderLevel: '', materialGroup: 'WOOD' as MaterialGroup, measurementKind: 'OTHER' as MaterialMeasurementKind };

// Locks the unit shown/submitted for every measurementKind except OTHER and
// LIQUID, matching the backend's own resolveUnit lock - so a material's
// physical unit and the quantities recorded against it (via PO items,
// issues, adjustments) can never disagree.
const LOCKED_MEASUREMENT_UNIT: Partial<Record<MaterialMeasurementKind, string>> = {
  BOARD_FEET: 'CFT',
  SHEET: 'Sheet',
  COUNT: 'Nos',
};

const ALL_TABS: [Tab, string, boolean][] = [
  // [key, label, hideForEmployee] - Stock Management (Godown) and Gallery
  // are Super Admin/Admin business data (pricing, customer-facing images),
  // not something a Carpenter/Carver/Polisher login needs; they only come
  // here for their own team's raw materials.
  ['products', 'Stock Management', true],
  ['gallery', 'Gallery', true],
  ['materials', 'Raw Material Stock', false],
  ['movements', 'Material Movement History', false],
  ['stock-movements', 'Stock Movement History', true],
];

export default function InventoryPage() {
  return (
    <Suspense fallback={<p className="text-brand-400 text-sm">Loading inventory...</p>}>
      <InventoryPageContent />
    </Suspense>
  );
}

function InventoryPageContent() {
  const { user, hasRole } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isEmployee = user?.role === 'CARPENTER' || user?.role === 'CARVER' || user?.role === 'POLISHER';
  const visibleTabs = ALL_TABS.filter(([, , hideForEmployee]) => !isEmployee || !hideForEmployee);
  const tabFromUrl = searchParams.get('tab') as Tab | null;
  const initialTab = tabFromUrl && ALL_TABS.some(([key]) => key === tabFromUrl) ? tabFromUrl : 'products';
  const [tab, setTabState] = useState<Tab>(initialTab);

  // Keeps the selected tab in the URL (via replace, so switching tabs
  // doesn't pile up history entries) so that navigating into a material's
  // detail page and back returns to the same tab instead of always
  // resetting to Stock Management.
  function setTab(next: Tab) {
    setTabState(next);
    router.replace(`/inventory?tab=${next}`, { scroll: false });
  }

  useEffect(() => {
    if (isEmployee && !visibleTabs.some(([key]) => key === tab)) {
      setTab(visibleTabs[0]?.[0] ?? 'materials');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmployee]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">Inventory</h1>
        <p className="text-sm text-brand-500 mt-1">Godown stock, raw material stock, and the product gallery.</p>
      </div>

      <div className="flex gap-1 border-b border-brand-200 overflow-x-auto">
        {visibleTabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === key ? 'border-brand-700 text-brand-900' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'products' && <ProductsTab canEdit={hasRole('ADMIN')} />}
      {tab === 'gallery' && <GalleryTab canEdit={hasRole('SUPERADMIN')} />}
      {tab === 'materials' && <MaterialsTab canEdit={hasRole('ADMIN')} />}
      {tab === 'movements' && <MovementsTab />}
      {tab === 'stock-movements' && <StockMovementsTab />}
    </div>
  );
}

function ProductsTab({ canEdit }: { canEdit: boolean }) {
  const [search, setSearch] = useState('');
  const [finishFilter, setFinishFilter] = useState('');
  const [stockStatusFilter, setStockStatusFilter] = useState<'' | 'IN_STOCK' | 'OUT_OF_STOCK'>('');
  const [page, setPage] = useState(1);
  // Every active filter (search + Finish + Stock Status) feeds the same API
  // call, so the current page's data - and therefore the CSV export below,
  // which always exports exactly what's on screen - reflects them all.
  const { data: result, isLoading, mutate } = useSWR<PaginatedResult<Product>>(
    `/products?${new URLSearchParams({
      ...(search ? { search } : {}),
      ...(finishFilter ? { finish: finishFilter } : {}),
      ...(stockStatusFilter ? { stockStatus: stockStatusFilter } : {}),
      page: String(page),
      limit: '20',
    })}`,
    fetcher,
  );
  const data = result?.data;
  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }
  function updateFinishFilter(value: string) {
    setFinishFilter(value);
    setPage(1);
  }
  function updateStockStatusFilter(value: '' | 'IN_STOCK' | 'OUT_OF_STOCK') {
    setStockStatusFilter(value);
    setPage(1);
  }

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyProductForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [viewTarget, setViewTarget] = useState<Product | null>(null);

  // Proactive duplicate-Model No check while typing - the backend already
  // rejects a duplicate on submit (Model No is @unique), this just surfaces
  // it before the user gets that far.
  const trimmedModelNo = form.modelNo.trim();
  const { data: modelNoMatches } = useSWR<Product[]>(
    trimmedModelNo ? `/products?search=${encodeURIComponent(trimmedModelNo)}` : null,
    fetcher,
  );
  const duplicateModelNo = (modelNoMatches ?? []).find(
    (p) => p.modelNo?.toLowerCase() === trimmedModelNo.toLowerCase() && p.id !== editing?.id,
  );

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkProductRow[]>([{ ...emptyBulkRow }]);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  function openCreate() {
    setEditing(null);
    setForm(emptyProductForm);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      modelNo: p.modelNo ?? '',
      sku: p.sku ?? '',
      name: p.name,
      category: p.category ?? '',
      modelSize: p.modelSize ?? '',
      materialFinish: p.materialFinish ?? '',
      sizeUnit: p.sizeUnit ?? '',
      pattern: p.pattern ?? '',
      details: p.details ?? '',
      unit: p.unit ?? '',
      retailPrice: String(p.retailPrice),
      wholesalePrice: p.wholesalePrice != null ? String(p.wholesalePrice) : '',
      costPrice: p.costPrice != null ? String(p.costPrice) : '',
    });
    setError(null);
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        modelNo: form.modelNo || undefined,
        sku: form.sku || undefined,
        name: form.name,
        category: form.category || undefined,
        modelSize: form.modelSize || undefined,
        materialFinish: form.materialFinish || undefined,
        sizeUnit: form.sizeUnit || undefined,
        pattern: form.pattern || undefined,
        details: form.details || undefined,
        unit: form.unit || undefined,
        retailPrice: parseFloat(form.retailPrice),
        wholesalePrice: form.wholesalePrice ? parseFloat(form.wholesalePrice) : undefined,
        costPrice: form.costPrice ? parseFloat(form.costPrice) : undefined,
      };
      if (editing) {
        await api.patch(`/products/${editing.id}`, payload);
      } else {
        await api.post<Product>('/products', payload);
      }
      setFormOpen(false);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save product');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await api.delete(`/products/${deleteTarget.id}`);
    setDeleteTarget(null);
    mutate();
  }

  function updateBulkRow(idx: number, patch: Partial<BulkProductRow>) {
    setBulkRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addBulkRow() {
    setBulkRows((rows) => [...rows, { ...emptyBulkRow }]);
  }
  function removeBulkRow(idx: number) {
    setBulkRows((rows) => rows.filter((_, i) => i !== idx));
  }

  async function handleBulkSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBulkError(null);
    const rowsToCreate = bulkRows.filter((r) => r.name.trim() && r.retailPrice);
    if (rowsToCreate.length === 0) {
      setBulkError('Add at least one product with a name and retail price');
      return;
    }
    setBulkSubmitting(true);
    let succeeded = 0;
    const failures: string[] = [];
    for (const row of rowsToCreate) {
      try {
        await api.post<Product>('/products', {
          modelNo: row.modelNo || undefined,
          name: row.name,
          category: row.category || undefined,
          materialFinish: row.finish || undefined,
          modelSize: row.size || undefined,
          retailPrice: parseFloat(row.retailPrice),
        });
        succeeded++;
      } catch (err) {
        failures.push(`${row.name}: ${err instanceof ApiError ? err.message : 'failed'}`);
      }
    }
    setBulkSubmitting(false);
    mutate();
    if (failures.length === 0) {
      setBulkOpen(false);
    } else {
      setBulkError(`Created ${succeeded} of ${rowsToCreate.length}. Failed: ${failures.join('; ')}`);
      setBulkRows(rowsToCreate.length === failures.length ? rowsToCreate : [{ ...emptyBulkRow }]);
    }
  }

  const totalAvailable = data?.reduce((s, p) => s + (p.availableQuantity ?? 0), 0) ?? 0;
  const outOfStock = data?.filter((p) => (p.availableQuantity ?? 0) <= 0).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Stock Products" value={String(data?.length ?? 0)} />
        <StatCard label="Available Units" value={String(totalAvailable)} accent="success" />
        <StatCard label="Out of Stock" value={String(outOfStock)} accent={outOfStock > 0 ? 'warning' : 'default'} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <input className="input max-w-xs" placeholder="Search name, SKU, Model No..." value={search} onChange={(e) => updateSearch(e.target.value)} />
          <input className="input max-w-[160px]" placeholder="Filter by Finish..." value={finishFilter} onChange={(e) => updateFinishFilter(e.target.value)} />
          <select
            className="input max-w-[160px]"
            value={stockStatusFilter}
            onChange={(e) => updateStockStatusFilter(e.target.value as '' | 'IN_STOCK' | 'OUT_OF_STOCK')}
          >
            <option value="">All stock status</option>
            <option value="IN_STOCK">In Stock</option>
            <option value="OUT_OF_STOCK">Sold / Out of Stock</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            onClick={() =>
              downloadCsv(
                'products',
                (data ?? []).map((p) => ({
                  'Model No': p.modelNo ?? 'Not Updated',
                  Name: p.name,
                  Finish: p.materialFinish ?? '',
                  Size: p.modelSize ?? '',
                  'Size Unit': p.sizeUnit ?? '',
                  Pattern: p.pattern ?? '',
                  Details: p.details ?? '',
                  'Unit Price': p.retailPrice,
                  Available: p.availableQuantity ?? 0,
                })),
              )
            }
          >
            Export Excel
          </button>
          {canEdit && (
            <>
              <button
                className="btn-secondary"
                onClick={() => {
                  setBulkRows([{ ...emptyBulkRow }]);
                  setBulkError(null);
                  setBulkOpen(true);
                }}
              >
                + Add Multiple
              </button>
              <button className="btn-primary" onClick={openCreate}>
                + Add Product
              </button>
            </>
          )}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>Model No</th>
              <th>Product</th>
              <th>Finish / Size</th>
              <th>Unit Price</th>
              <th>Available</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-brand-400">
                  Loading products...
                </td>
              </tr>
            )}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-brand-400">
                  No products yet
                </td>
              </tr>
            )}
            {data?.map((p) => (
              <tr key={p.id}>
                <td className="text-xs whitespace-nowrap">
                  {p.modelNo ? <span className="font-medium text-ink">{p.modelNo}</span> : <span className="text-brand-400 italic">Not Updated</span>}
                </td>
                <td>{p.name}</td>
                <td className="text-xs text-brand-500">{[p.materialFinish, p.modelSize && p.sizeUnit ? `${p.modelSize} ${p.sizeUnit}` : p.modelSize].filter(Boolean).join(' / ') || '-'}</td>
                <td className="font-medium">{formatCurrency(p.retailPrice)}</td>
                <td className={(p.availableQuantity ?? 0) <= 0 ? 'text-red-600 font-medium' : 'text-emerald-700 font-medium'}>
                  {(p.availableQuantity ?? 0) > 0 ? 'In Stock' : 'Sold'}
                </td>
                <td className="space-x-2 whitespace-nowrap">
                  <button className="text-brand-600 hover:underline text-xs" onClick={() => setViewTarget(p)}>
                    View
                  </button>
                  {canEdit && (
                    <>
                      <button className="text-brand-600 hover:underline text-xs" onClick={() => openEdit(p)}>
                        Edit
                      </button>
                      <button className="text-red-600 hover:underline text-xs" onClick={() => setDeleteTarget(p)}>
                        Delete
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
        <Modal title={editing ? 'Edit Stock Product' : 'Add Stock Product'} onClose={() => setFormOpen(false)} wide>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label">Model No</label>
              <input
                className={`input ${duplicateModelNo ? 'border-red-500' : ''}`}
                value={form.modelNo}
                onChange={(e) => setForm((f) => ({ ...f, modelNo: e.target.value }))}
                placeholder="Leave blank to set later - Production Employee can assign it"
              />
              {duplicateModelNo && (
                <p className="text-[11px] text-red-600 mt-1">
                  Model No &quot;{trimmedModelNo}&quot; already exists ({duplicateModelNo.name}) - Model No must be unique.
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Product</label>
                <input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">SKU</label>
                <input className="input" value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} placeholder="PRD-1012" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Finish</label>
                <input className="input" value={form.materialFinish} onChange={(e) => setForm((f) => ({ ...f, materialFinish: e.target.value }))} />
              </div>
              <div>
                <label className="label">Pattern</label>
                <input className="input" value={form.pattern} onChange={(e) => setForm((f) => ({ ...f, pattern: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Size</label>
                <input className="input" value={form.modelSize} onChange={(e) => setForm((f) => ({ ...f, modelSize: e.target.value }))} />
              </div>
              <div>
                <label className="label">Size Unit</label>
                <UnitSelect id="product-size-unit" value={form.sizeUnit} onChange={(v) => setForm((f) => ({ ...f, sizeUnit: v }))} />
              </div>
            </div>
            <div>
              <label className="label">Details</label>
              <input className="input" value={form.details} onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Category</label>
                <input className="input" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
              </div>
              <div>
                <label className="label">Unit</label>
                <UnitSelect id="product-unit" value={form.unit} onChange={(v) => setForm((f) => ({ ...f, unit: v }))} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="label">Unit Price</label>
                <input type="number" min="0" step="0.01" className="input" required value={form.retailPrice} onChange={(e) => setForm((f) => ({ ...f, retailPrice: e.target.value }))} />
              </div>
              <div>
                <label className="label">Wholesale Price</label>
                <input type="number" min="0" step="0.01" className="input" value={form.wholesalePrice} onChange={(e) => setForm((f) => ({ ...f, wholesalePrice: e.target.value }))} />
              </div>
              <div>
                <label className="label">MFG Price</label>
                <input type="number" min="0" step="0.01" className="input" value={form.costPrice} onChange={(e) => setForm((f) => ({ ...f, costPrice: e.target.value }))} />
              </div>
            </div>
            {editing && (
              <p className="text-sm text-brand-500 border-t border-brand-100 pt-3">
                Status: <span className={editing.availableQuantity ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}>{editing.availableQuantity ? 'In Stock' : 'Sold'}</span>
              </p>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
                {editing ? 'Done' : 'Cancel'}
              </button>
              <button type="submit" disabled={submitting || Boolean(duplicateModelNo)} className="btn-primary">
                {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Add Product'}
              </button>
            </div>
          </form>
        </Modal>
      )}


      {bulkOpen && (
        <Modal title="Add Multiple Products" onClose={() => setBulkOpen(false)} wide>
          <form onSubmit={handleBulkSubmit} className="space-y-4">
            <p className="text-sm text-brand-500">Each card below becomes one piece in stock - Model No is optional per piece.</p>
            <div className="space-y-3 max-h-[55vh] overflow-y-auto">
              {bulkRows.map((row, idx) => (
                <div key={idx} className="border border-brand-100 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-brand-400">Piece {idx + 1}</span>
                    <button type="button" className="text-red-500 text-xs hover:underline" onClick={() => removeBulkRow(idx)} disabled={bulkRows.length === 1}>
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-brand-400">Model No</label>
                      <input className="input" placeholder="Leave blank to set later" value={row.modelNo} onChange={(e) => updateBulkRow(idx, { modelNo: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-[11px] text-brand-400">Product Name</label>
                      <input className="input" placeholder="e.g. CHAKKURA" required value={row.name} onChange={(e) => updateBulkRow(idx, { name: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[11px] text-brand-400">Category</label>
                      <input className="input" value={row.category} onChange={(e) => updateBulkRow(idx, { category: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-[11px] text-brand-400">Finish</label>
                      <input className="input" value={row.finish} onChange={(e) => updateBulkRow(idx, { finish: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-[11px] text-brand-400">Size</label>
                      <input className="input" value={row.size} onChange={(e) => updateBulkRow(idx, { size: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-brand-400">Unit Price</label>
                    <input type="number" step="0.01" min="0" className="input" required value={row.retailPrice} onChange={(e) => updateBulkRow(idx, { retailPrice: e.target.value })} />
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="text-brand-600 text-sm hover:underline" onClick={addBulkRow}>
              + Add another piece
            </button>

            {bulkError && <p className="text-sm text-red-600">{bulkError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setBulkOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={bulkSubmitting} className="btn-primary">
                {bulkSubmitting ? 'Creating...' : `Create ${bulkRows.filter((r) => r.name.trim()).length || ''} Products`}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Stock Product"
          message={`Delete ${deleteTarget.name} from Godown Stock?`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {viewTarget && (
        <Modal title={`${viewTarget.name} - Full Details`} onClose={() => setViewTarget(null)}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <ViewField label="Model No" value={viewTarget.modelNo ?? 'Not Updated'} />
            <ViewField label="Status" value={(viewTarget.availableQuantity ?? 0) > 0 ? 'In Stock' : 'Sold'} />
            <ViewField label="Product" value={viewTarget.name} />
            <ViewField label="SKU" value={viewTarget.sku ?? '-'} />
            <ViewField label="Category" value={viewTarget.category ?? '-'} />
            <ViewField label="Unit" value={viewTarget.unit ?? '-'} />
            <ViewField label="Finish" value={viewTarget.materialFinish ?? '-'} />
            <ViewField label="Pattern" value={viewTarget.pattern ?? '-'} />
            <ViewField label="Size" value={viewTarget.modelSize ?? '-'} />
            <ViewField label="Size Unit" value={viewTarget.sizeUnit ?? '-'} />
            <ViewField label="Unit Price" value={formatCurrency(viewTarget.retailPrice)} />
            <ViewField label="Wholesale Price" value={viewTarget.wholesalePrice != null ? formatCurrency(viewTarget.wholesalePrice) : '-'} />
            <ViewField label="MFG Price" value={viewTarget.costPrice != null ? formatCurrency(viewTarget.costPrice) : '-'} />
            <ViewField label="Added" value={formatDate(viewTarget.createdAt)} />
            <div className="col-span-2">
              <ViewField label="Details" value={viewTarget.details ?? '-'} />
            </div>
          </div>
          <div className="flex justify-end pt-4">
            <button className="btn-secondary" onClick={() => setViewTarget(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Images-only visual reference of manufactured furniture (spec: "Gallery is
// ONLY for product images" - no price/size/finish/pattern/category/quantity
// shown here, unlike the Stock Management tab above). Upload/delete are
// Super Admin only; sending an image via WhatsApp reuses the existing
// useWhatsApp()/WhatsAppModal flow rather than a separate send system.
interface StagedImage {
  file: File;
  previewUrl: string;
  error: string | null;
}

function GalleryTab({ canEdit }: { canEdit: boolean }) {
  const [staged, setStaged] = useState<StagedImage[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { showModal, whatsappOptions, openWhatsApp, closeWhatsApp } = useWhatsApp();
  const [refreshKey, setRefreshKey] = useState(0);

  // Selecting files only stages them for review - nothing uploads until
  // Save is clicked. Each file is validated immediately (type + 1 MB cap)
  // so oversized/invalid images show a red "quarantined" mark right away.
  function stageFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next = Array.from(files).map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      error: validateProductImageFile(file),
    }));
    setStaged((prev) => [...prev, ...next]);
    setSaveError(null);
    setReviewOpen(true);
  }

  function removeStaged(idx: number) {
    setStaged((prev) => {
      URL.revokeObjectURL(prev[idx].previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }

  function closeReview() {
    staged.forEach((s) => URL.revokeObjectURL(s.previewUrl));
    setStaged([]);
    setReviewOpen(false);
    setSaveError(null);
  }

  async function handleSaveStaged() {
    const valid = staged.filter((s) => !s.error);
    if (valid.length === 0) {
      setSaveError('No valid images to save - fix or remove the flagged ones first.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    const failures: string[] = [];
    for (const s of valid) {
      try {
        await uploadGalleryImage(s.file);
      } catch {
        failures.push(s.file.name);
      }
    }
    setSaving(false);
    setRefreshKey((k) => k + 1);
    if (failures.length > 0) {
      setSaveError(`Failed to upload: ${failures.join(', ')}`);
      setStaged((prev) => prev.filter((s) => failures.includes(s.file.name)));
    } else {
      closeReview();
    }
  }

  function handleSend(image: GalleryImage) {
    openWhatsApp({
      recipientName: image.modelNo ?? 'Customer',
      defaultImageUrl: assetUrl(image.url) ?? undefined,
      defaultMessage: image.caption ?? '',
    });
  }

  const validCount = staged.filter((s) => !s.error).length;
  const invalidCount = staged.length - validCount;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-brand-500">Photos of manufactured furniture, for quick visual sharing with customers.</p>
        {canEdit && (
          <label className="btn-primary cursor-pointer">
            + Upload Images
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                stageFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>
      <p className="text-[11px] text-brand-400">Images: JPG, PNG, or WebP, max 1 MB each.</p>

      <GalleryGrid key={refreshKey} canManage={canEdit} onSend={handleSend} />

      {reviewOpen && (
        <Modal title="Review Images Before Saving" onClose={closeReview} wide>
          <div className="space-y-3">
            <p className="text-sm text-brand-500">
              {validCount} ready to save
              {invalidCount > 0 && <span className="text-red-600"> · {invalidCount} over 1 MB (quarantined - won&apos;t be saved)</span>}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-h-[50vh] overflow-y-auto">
              {staged.map((s, idx) => (
                <div key={idx} className={`card p-2 space-y-1 ${s.error ? 'ring-2 ring-red-500' : ''}`}>
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.previewUrl} alt={s.file.name} className="w-full aspect-square object-cover rounded-md" />
                    {s.error && (
                      <span className="absolute top-1 right-1 bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded">Over 1 MB</span>
                    )}
                  </div>
                  <p className="text-[11px] truncate">{s.file.name}</p>
                  <p className="text-[10px] text-brand-400">{(s.file.size / 1024).toFixed(0)} KB</p>
                  {s.error && <p className="text-[10px] text-red-600">{s.error}</p>}
                  <button type="button" className="text-[11px] text-red-500 hover:underline" onClick={() => removeStaged(idx)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            {saveError && <p className="text-sm text-red-600">{saveError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={closeReview} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={handleSaveStaged} disabled={saving || validCount === 0}>
                {saving ? 'Saving...' : `Save ${validCount} Image${validCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showModal && whatsappOptions && (
        <WhatsAppModal
          onClose={closeWhatsApp}
          recipientInfo={{ name: whatsappOptions.recipientName, phone: whatsappOptions.recipientPhone }}
          defaultMessage={whatsappOptions.defaultMessage}
          defaultImageUrl={whatsappOptions.defaultImageUrl}
        />
      )}
    </div>
  );
}

function MaterialsTab({ canEdit }: { canEdit: boolean }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data: result, isLoading, mutate } = useSWR<PaginatedResult<RawMaterial>>(
    `/raw-materials?${new URLSearchParams({ ...(search ? { search } : {}), page: String(page), limit: '20' })}`,
    fetcher,
  );
  const data = result?.data;
  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyMaterialForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editTarget, setEditTarget] = useState<RawMaterial | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RawMaterial | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openAdd() {
    setEditTarget(null);
    setForm(emptyMaterialForm);
    setError(null);
    setFormOpen(true);
  }
  function openEdit(m: RawMaterial) {
    setEditTarget(m);
    setForm({
      name: m.name,
      type: m.type ?? '',
      unit: m.unit,
      reorderLevel: m.reorderLevel != null ? String(m.reorderLevel) : '',
      materialGroup: m.materialGroup,
      measurementKind: m.measurementKind,
    });
    setError(null);
    setFormOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await api.delete(`/raw-materials/${deleteTarget.id}`);
      setDeleteTarget(null);
      mutate();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Failed to delete material');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        type: form.type || undefined,
        unit: form.measurementKind === 'OTHER' || form.measurementKind === 'LIQUID' ? form.unit : undefined,
        reorderLevel: form.reorderLevel ? parseFloat(form.reorderLevel) : undefined,
        materialGroup: form.materialGroup,
        measurementKind: form.measurementKind,
      };
      if (editTarget) {
        await api.patch(`/raw-materials/${editTarget.id}`, payload);
      } else {
        await api.post('/raw-materials', payload);
      }
      setFormOpen(false);
      setEditTarget(null);
      setForm(emptyMaterialForm);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to ${editTarget ? 'update' : 'add'} material`);
    } finally {
      setSubmitting(false);
    }
  }

  const stockValue = data?.reduce((s, m) => s + m.stockValue, 0) ?? 0;
  const belowMin = data?.filter((m) => m.isLow).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Raw Material Items" value={String(data?.length ?? 0)} />
        <StatCard label="Raw Stock Value" value={formatCurrency(stockValue)} />
        <StatCard label="Below Minimum" value={String(belowMin)} accent={belowMin > 0 ? 'warning' : 'default'} sub="Reorder needed" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <input className="input max-w-xs" placeholder="Search material name or type..." value={search} onChange={(e) => updateSearch(e.target.value)} />
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            onClick={() =>
              downloadCsv(
                'raw-materials',
                (data ?? []).map((m) => ({
                  Material: m.name,
                  Type: m.type ?? '',
                  Unit: m.unit,
                  'In Stock': m.inStock,
                  Min: m.reorderLevel ?? '',
                  'Purchase Rate': m.purchaseRate,
                  'Stock Value': m.stockValue,
                })),
              )
            }
          >
            Export Excel
          </button>
          {canEdit && (
            <button className="btn-primary" onClick={openAdd}>
              + Add Material
            </button>
          )}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>Material</th>
              <th>Type</th>
              <th>Team</th>
              <th>Unit</th>
              <th>Current Stock</th>
              <th>Minimum Stock</th>
              <th>Purchase Rate</th>
              <th>Stock Value</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={10} className="text-center py-8 text-brand-400">
                  Loading materials...
                </td>
              </tr>
            )}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-8 text-brand-400">
                  No raw materials yet
                </td>
              </tr>
            )}
            {data?.map((m) => (
              <tr key={m.id}>
                <td className="font-medium">{m.name}</td>
                <td>{m.type ?? '-'}</td>
                <td>{MATERIAL_GROUP_LABEL[m.materialGroup]}</td>
                <td>{m.unit}</td>
                <td>
                  {m.totalPurchasedPieces != null ? (
                    <>
                      {m.totalPurchasedPieces - (m.totalConsumedPieces ?? 0)} pcs
                      <span className="block text-[10px] text-brand-400">
                        {m.inStock} {m.unit}
                        {m.hasUntrackedAdjustment ? ' · adj. not counted' : ''}
                      </span>
                    </>
                  ) : (
                    m.inStock
                  )}
                </td>
                <td>{m.reorderLevel ?? '-'}</td>
                <td>{formatCurrency(m.purchaseRate)}</td>
                <td>{formatCurrency(m.stockValue)}</td>
                <td>
                  {m.inStock <= 0 ? (
                    <Chip color="red" label="Out of Stock" />
                  ) : m.isLow ? (
                    <Chip color="amber" label="Low Stock" />
                  ) : (
                    <Chip color="green" label="In Stock" />
                  )}
                </td>
                <td>
                  <div className="flex items-center gap-2.5 whitespace-nowrap">
                    <Link href={`/inventory/materials/${m.id}`} className="text-brand-600 hover:underline text-xs">
                      Manage
                    </Link>
                    {canEdit && (
                      <>
                        <button className="text-brand-600 hover:underline text-xs" onClick={() => openEdit(m)}>
                          Edit
                        </button>
                        <button className="text-red-600 hover:underline text-xs" onClick={() => setDeleteTarget(m)}>
                          Delete
                        </button>
                      </>
                    )}
                  </div>
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
        <Modal title={editTarget ? `Edit ${editTarget.name}` : 'Add Raw Material'} onClose={() => setFormOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label">Name</label>
              <input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Plywood 19mm" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Type</label>
                <input className="input" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} placeholder="Plywood / Timber / Mica" />
              </div>
              <div>
                <label className="label">Measurement Type</label>
                <select
                  className="input"
                  value={form.measurementKind}
                  onChange={(e) => setForm((f) => ({ ...f, measurementKind: e.target.value as MaterialMeasurementKind, unit: '' }))}
                >
                  <option value="OTHER">Other (choose a unit below)</option>
                  <option value="BOARD_FEET">Wood / Timber - CFT</option>
                  <option value="SHEET">Plywood / Sheet material</option>
                  <option value="LIQUID">Polish / Liquid</option>
                  <option value="COUNT">Tools / Hardware - Nos</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label">Unit</label>
              {LOCKED_MEASUREMENT_UNIT[form.measurementKind] ? (
                <div className="input bg-brand-50 text-brand-700">{LOCKED_MEASUREMENT_UNIT[form.measurementKind]}</div>
              ) : form.measurementKind === 'LIQUID' ? (
                <select className="input" required value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}>
                  <option value="">Select unit...</option>
                  <option value="Litre">Litre</option>
                  <option value="Kg">Kg</option>
                  <option value="Gram">Gram</option>
                </select>
              ) : (
                <UnitSelect id="material-unit" required value={form.unit} onChange={(v) => setForm((f) => ({ ...f, unit: v }))} />
              )}
            </div>
            <div>
              <label className="label">Team (which employees can use this material)</label>
              <select className="input" value={form.materialGroup} onChange={(e) => setForm((f) => ({ ...f, materialGroup: e.target.value as MaterialGroup }))}>
                <option value="WOOD">Carpenter Team</option>
                <option value="CARVING">Carving Team</option>
                <option value="POLISH">Polish Team</option>
                <option value="OTHER">Other / Shared</option>
              </select>
            </div>
            <div>
              <label className="label">Reorder Level (minimum stock)</label>
              <input type="number" min="0" step="0.01" className="input" value={form.reorderLevel} onChange={(e) => setForm((f) => ({ ...f, reorderLevel: e.target.value }))} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? 'Saving...' : editTarget ? 'Save Changes' : 'Add Material'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Raw Material"
          message={deleteError ?? `Delete ${deleteTarget.name}? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
        />
      )}
    </div>
  );
}

const MOVEMENT_TYPE_OPTIONS = [
  { value: 'IN', label: 'Stock In' },
  { value: 'OUT', label: 'Issued / Consumed' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
];
const MOVEMENT_ROLE_OPTIONS: { value: WorkerType; label: string }[] = [
  { value: 'CARPENTER', label: 'Carpenter' },
  { value: 'CARVER', label: 'Carving' },
  { value: 'POLISHER', label: 'Polisher' },
];
const MOVEMENT_REFERENCE_OPTIONS = [
  { value: 'PURCHASE', label: 'Purchase' },
  { value: 'PRODUCTION', label: 'Production' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
];
const emptyMovementFilters: Record<string, string> = {};

function MovementsTab() {
  const [page, setPage] = useState(1);
  const [values, setValues] = useState<Record<string, string>>(emptyMovementFilters);
  const [applied, setApplied] = useState<Record<string, string>>(emptyMovementFilters);
  const [downloading, setDownloading] = useState(false);
  const { data: materials } = useSWR<RawMaterial[]>('/raw-materials', fetcher);
  const { data: carpenters } = useSWR<CarpenterSummary[]>('/carpenters', fetcher);

  const queryParams = new URLSearchParams({ ...applied, page: String(page), limit: '20' });
  const { data: result, isLoading } = useSWR<PaginatedResult<StockMovement>>(`/stock-movements?${queryParams}`, fetcher);
  const data = result?.data;

  function applyFilters() {
    setApplied(values);
    setPage(1);
  }
  function resetFilters() {
    setValues(emptyMovementFilters);
    setApplied(emptyMovementFilters);
    setPage(1);
  }

  async function downloadPdf() {
    setDownloading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${API_BASE_URL}/raw-materials/movements/pdf?${new URLSearchParams(applied)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `material-movement-history-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  const typeChip = (type: string) => {
    if (type === 'IN') return <Chip color="green" label="Stock In" />;
    if (type === 'OUT') return <Chip color="amber" label="Issued" />;
    return <Chip color="blue" label="Adjustment" />;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FilterBar
          fields={[
            { key: 'dateFrom', label: 'Date From', type: 'date' },
            { key: 'dateTo', label: 'Date To', type: 'date' },
            { key: 'type', label: 'Movement Type', type: 'select', options: MOVEMENT_TYPE_OPTIONS },
            { key: 'carpenterId', label: 'Employee', type: 'select', options: (carpenters ?? []).map((c) => ({ value: c.id, label: c.name })) },
            { key: 'workerType', label: 'Role', type: 'select', options: MOVEMENT_ROLE_OPTIONS },
            { key: 'reference', label: 'Reference', type: 'select', options: MOVEMENT_REFERENCE_OPTIONS },
            { key: 'rawMaterialId', label: 'Material', type: 'select', options: (materials ?? []).map((m) => ({ value: m.id, label: m.name })) },
          ]}
          values={values}
          onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
          onApply={applyFilters}
          onReset={resetFilters}
        />
        <button className="btn-secondary h-9 px-4 text-sm" onClick={downloadPdf} disabled={downloading}>
          {downloading ? 'Preparing...' : 'Download PDF'}
        </button>
      </div>
      <div className="card overflow-x-auto">
      <table className="table-shell">
        <thead>
          <tr>
            <th>Date</th>
            <th>Material</th>
            <th>Type</th>
            <th>Qty</th>
            <th>Length</th>
            <th>Width</th>
            <th>Amount</th>
            <th>Supplier / Employee</th>
            <th>Role</th>
            <th>Reason</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td colSpan={11} className="text-center py-8 text-brand-400">
                Loading movements...
              </td>
            </tr>
          )}
          {!isLoading && data?.length === 0 && (
            <tr>
              <td colSpan={11} className="text-center py-8 text-brand-400">
                No stock movements yet
              </td>
            </tr>
          )}
          {data?.map((m) => (
            <tr key={m.id}>
              <td>{formatDate(m.date)}</td>
              <td>{m.rawMaterial?.name}</td>
              <td>{typeChip(m.type)}</td>
              <td className={m.quantity < 0 ? 'text-red-600' : 'text-emerald-600'}>
                {m.pieces != null ? (
                  <>
                    {m.pieces} pcs <span className="text-brand-400">({m.quantity > 0 ? '+' : ''}{m.quantity} {m.rawMaterial?.unit})</span>
                  </>
                ) : (
                  <>
                    {m.quantity > 0 ? '+' : ''}
                    {m.quantity} {m.rawMaterial?.unit}
                  </>
                )}
              </td>
              <td className="text-brand-500">{m.lengthFt != null ? `${m.lengthFt} ft` : '-'}</td>
              <td className="text-brand-500">{m.widthIn != null ? `${m.widthIn} in` : '-'}</td>
              <td className="text-brand-500">{m.amount != null ? formatCurrency(m.amount) : '-'}</td>
              <td className="text-brand-500">{m.purchase?.supplier?.name ?? m.workItem?.carpenter?.name ?? '-'}</td>
              <td className="text-brand-500">{m.workItem?.carpenter?.workerType ?? '-'}</td>
              <td className="text-brand-500">{m.reason ?? '-'}</td>
              <td>{m.createdBy?.name ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result && (
        <Pagination page={result.page} totalPages={result.totalPages} total={result.total} limit={result.limit} onPageChange={setPage} />
      )}
      </div>
    </div>
  );
}

const STOCK_MOVEMENT_TYPE_CHIP: Record<string, { color: 'green' | 'amber' | 'red' | 'blue' | 'gray'; label: string }> = {
  IN: { color: 'green', label: 'Stock In' },
  RESERVED: { color: 'amber', label: 'Reserved' },
  RELEASED: { color: 'blue', label: 'Released' },
  DISPATCHED: { color: 'gray', label: 'Dispatched' },
  ADJUSTMENT: { color: 'blue', label: 'Adjustment' },
};

// Godown finished-stock movement history - separate from the raw-material
// MovementsTab above (different domain: finished furniture, not lumber/
// hardware consumed by a work item).
function StockMovementsTab() {
  const [page, setPage] = useState(1);
  const { data: result, isLoading } = useSWR<PaginatedResult<ProductStockMovement>>(
    `/products/stock-movements?${new URLSearchParams({ page: String(page), limit: '20' })}`,
    fetcher,
  );
  const data = result?.data;

  return (
    <div className="card overflow-x-auto">
      <table className="table-shell">
        <thead>
          <tr>
            <th>Date</th>
            <th>Product</th>
            <th>Type</th>
            <th>Qty</th>
            <th>Available After</th>
            <th>Reason</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td colSpan={7} className="text-center py-8 text-brand-400">
                Loading movements...
              </td>
            </tr>
          )}
          {!isLoading && data?.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center py-8 text-brand-400">
                No stock movements yet
              </td>
            </tr>
          )}
          {data?.map((m) => {
            const chip = STOCK_MOVEMENT_TYPE_CHIP[m.type] ?? { color: 'gray' as const, label: m.type };
            return (
              <tr key={m.id}>
                <td>{formatDate(m.createdAt)}</td>
                <td>
                  {m.product?.name}
                  {m.product?.modelNo && <div className="text-xs text-brand-400">{m.product.modelNo}</div>}
                </td>
                <td>
                  <Chip color={chip.color} label={chip.label} />
                </td>
                <td className={m.type === 'IN' || m.type === 'RELEASED' ? 'text-emerald-600' : 'text-red-600'}>
                  {m.type === 'IN' || m.type === 'RELEASED' ? '+' : '-'}
                  {m.quantity}
                </td>
                <td>{m.newAvailable}</td>
                <td className="text-brand-500">{m.reason ?? '-'}</td>
                <td>{m.createdBy?.name ?? '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {result && (
        <Pagination page={result.page} totalPages={result.totalPages} total={result.total} limit={result.limit} onPageChange={setPage} />
      )}
    </div>
  );
}
