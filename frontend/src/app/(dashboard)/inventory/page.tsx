'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatCard } from '@/components/StatCard';
import { Chip } from '@/components/StatusBadge';
import { ProductImages } from '@/components/ProductImages';
import { downloadCsv } from '@/lib/csv';
import { assetUrl, uploadProductImage, validateProductImageFile } from '@/lib/api';
import type { Product, RawMaterial, StockMovement, WorkerType } from '@/types';

type Tab = 'products' | 'materials' | 'movements';

const emptyProductForm = {
  sku: '',
  name: '',
  category: '',
  modelSize: '',
  materialFinish: '',
  unit: '',
  retailPrice: '',
  wholesalePrice: '',
  costPrice: '',
};

interface BulkProductRow {
  name: string;
  category: string;
  unit: string;
  retailPrice: string;
  wholesalePrice: string;
  costPrice: string;
  imageFile: File | null;
  imageError: string | null;
}

const emptyBulkRow: BulkProductRow = {
  name: '',
  category: '',
  unit: '',
  retailPrice: '',
  wholesalePrice: '',
  costPrice: '',
  imageFile: null,
  imageError: null,
};

const emptyMaterialForm = { name: '', type: '', unit: '', reorderLevel: '' };

export default function InventoryPage() {
  const { hasRole } = useAuth();
  const [tab, setTab] = useState<Tab>('products');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">Inventory</h1>
        <p className="text-sm text-brand-500 mt-1">Product price list and raw material stock used across production.</p>
      </div>

      <div className="flex gap-1 border-b border-brand-200">
        {(
          [
            ['products', 'Product Catalogue'],
            ['materials', 'Raw Material Stock'],
            ['movements', 'Stock Movement History'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key ? 'border-brand-700 text-brand-900' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'products' && <ProductsTab canEdit={hasRole('ADMIN')} />}
      {tab === 'materials' && <MaterialsTab canEdit={hasRole('ADMIN')} />}
      {tab === 'movements' && <MovementsTab />}
    </div>
  );
}

function ProductsTab({ canEdit }: { canEdit: boolean }) {
  const [search, setSearch] = useState('');
  const { data, isLoading, mutate } = useSWR<Product[]>(`/products?${new URLSearchParams(search ? { search } : {})}`, fetcher);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyProductForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

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
      sku: p.sku ?? '',
      name: p.name,
      category: p.category ?? '',
      modelSize: p.modelSize ?? '',
      materialFinish: p.materialFinish ?? '',
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
        sku: form.sku || undefined,
        name: form.name,
        category: form.category || undefined,
        modelSize: form.modelSize || undefined,
        materialFinish: form.materialFinish || undefined,
        unit: form.unit || undefined,
        retailPrice: parseFloat(form.retailPrice),
        wholesalePrice: form.wholesalePrice ? parseFloat(form.wholesalePrice) : undefined,
        costPrice: form.costPrice ? parseFloat(form.costPrice) : undefined,
      };
      if (editing) {
        await api.patch(`/products/${editing.id}`, payload);
        setFormOpen(false);
      } else {
        // Keep the modal open and switch into edit mode on the newly
        // created product, so images can be uploaded immediately without
        // a separate re-open step (a product must exist before it can own
        // uploaded images).
        const created = await api.post<Product>('/products', payload);
        setEditing(created);
      }
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save product');
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshEditing() {
    if (!editing) return;
    const fresh = await api.get<Product>(`/products/${editing.id}`);
    setEditing(fresh);
    mutate();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await api.delete(`/products/${deleteTarget.id}`);
    setDeleteTarget(null);
    mutate();
  }

  function selectBulkImage(idx: number, file: File | null) {
    if (!file) {
      updateBulkRow(idx, { imageFile: null, imageError: null });
      return;
    }
    const validationError = validateProductImageFile(file);
    updateBulkRow(idx, { imageFile: validationError ? null : file, imageError: validationError });
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
        const created = await api.post<Product>('/products', {
          name: row.name,
          category: row.category || undefined,
          unit: row.unit || undefined,
          retailPrice: parseFloat(row.retailPrice),
          wholesalePrice: row.wholesalePrice ? parseFloat(row.wholesalePrice) : undefined,
          costPrice: row.costPrice ? parseFloat(row.costPrice) : undefined,
        });
        succeeded++;
        if (row.imageFile) {
          try {
            await uploadProductImage(created.id, row.imageFile);
          } catch (imgErr) {
            failures.push(`${row.name}: created, but image failed (${imgErr instanceof ApiError ? imgErr.message : 'upload error'})`);
          }
        }
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

  const totalValue = data?.reduce((s, p) => s + p.retailPrice, 0) ?? 0;
  const categories = new Set((data ?? []).map((p) => p.category).filter(Boolean)).size;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Products" value={String(data?.length ?? 0)} />
        <StatCard label="Categories" value={String(categories)} />
        <StatCard label="Catalogue Value" value={formatCurrency(totalValue)} sub="Sum of retail prices" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <input className="input max-w-xs" placeholder="Search name, SKU, category..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            onClick={() =>
              downloadCsv(
                'products',
                (data ?? []).map((p) => ({
                  SKU: p.sku ?? '',
                  Name: p.name,
                  Category: p.category ?? '',
                  Size: p.modelSize ?? '',
                  'Material/Finish': p.materialFinish ?? '',
                  Retail: p.retailPrice,
                  Wholesale: p.wholesalePrice ?? '',
                  MFG: p.costPrice ?? '',
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
              <th></th>
              <th>SKU</th>
              <th>Name</th>
              <th>Category</th>
              <th>Size</th>
              <th>Material / Finish</th>
              <th>Retail</th>
              <th>Wholesale</th>
              <th>MFG</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={10} className="text-center py-8 text-brand-400">
                  Loading products...
                </td>
              </tr>
            )}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-8 text-brand-400">
                  No products yet
                </td>
              </tr>
            )}
            {data?.map((p) => {
              const primaryImage = p.images?.find((img) => img.isPrimary) ?? p.images?.[0];
              return (
              <tr key={p.id}>
                <td>
                  {primaryImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={assetUrl(primaryImage.url) ?? ''}
                      alt={p.name}
                      className="h-9 w-9 rounded-md object-cover border border-brand-200"
                    />
                  ) : (
                    <div className="h-9 w-9 rounded-md bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-300 text-[9px]">
                      No image
                    </div>
                  )}
                </td>
                <td className="text-brand-600 font-medium">{p.sku ?? '-'}</td>
                <td>{p.name}</td>
                <td>{p.category ?? '-'}</td>
                <td>{p.modelSize ?? '-'}</td>
                <td>{p.materialFinish ?? '-'}</td>
                <td className="font-medium">{formatCurrency(p.retailPrice)}</td>
                <td>{p.wholesalePrice != null ? formatCurrency(p.wholesalePrice) : '-'}</td>
                <td>{p.costPrice != null ? formatCurrency(p.costPrice) : '-'}</td>
                {canEdit && (
                  <td className="space-x-2">
                    <button className="text-brand-600 hover:underline text-xs" onClick={() => openEdit(p)}>
                      Edit
                    </button>
                    <button className="text-red-600 hover:underline text-xs" onClick={() => setDeleteTarget(p)}>
                      Delete
                    </button>
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <Modal title={editing ? 'Edit Product' : 'Add Product'} onClose={() => setFormOpen(false)} wide>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Name</label>
                <input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">SKU</label>
                <input className="input" value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} placeholder="PRD-1012" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Category</label>
                <input className="input" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
              </div>
              <div>
                <label className="label">Unit</label>
                <input className="input" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} placeholder="Nos / Set" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Model / Size</label>
                <input className="input" value={form.modelSize} onChange={(e) => setForm((f) => ({ ...f, modelSize: e.target.value }))} />
              </div>
              <div>
                <label className="label">Material / Finish</label>
                <input className="input" value={form.materialFinish} onChange={(e) => setForm((f) => ({ ...f, materialFinish: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="label">Retail Price</label>
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

            {editing ? (
              <ProductImages product={editing} onChange={refreshEditing} />
            ) : (
              <p className="text-xs text-brand-400">Save the product first, then upload images below.</p>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
                {editing ? 'Done' : 'Cancel'}
              </button>
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Add Product'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {bulkOpen && (
        <Modal title="Add Multiple Products" onClose={() => setBulkOpen(false)} wide>
          <form onSubmit={handleBulkSubmit} className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-[1fr_120px_90px_100px_100px_100px_80px_auto] gap-2 text-[11px] font-medium text-ink-muted px-0.5 hidden sm:grid">
              <span>Name</span>
              <span>Category</span>
              <span>Unit</span>
              <span>Retail</span>
              <span>Wholesale</span>
              <span>MFG</span>
              <span>Image</span>
              <span></span>
            </div>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {bulkRows.map((row, idx) => (
                <div key={idx} className="border-b border-brand-100 pb-2 sm:border-0 sm:pb-0">
                  <div className="grid grid-cols-2 sm:grid-cols-[1fr_120px_90px_100px_100px_100px_80px_auto] gap-2 sm:items-center">
                    <input className="input col-span-2 sm:col-span-1" placeholder="Name" required value={row.name} onChange={(e) => updateBulkRow(idx, { name: e.target.value })} />
                    <input className="input" placeholder="Category" value={row.category} onChange={(e) => updateBulkRow(idx, { category: e.target.value })} />
                    <input className="input" placeholder="Unit" value={row.unit} onChange={(e) => updateBulkRow(idx, { unit: e.target.value })} />
                    <input type="number" step="0.01" className="input" placeholder="Retail" required value={row.retailPrice} onChange={(e) => updateBulkRow(idx, { retailPrice: e.target.value })} />
                    <input type="number" step="0.01" className="input" placeholder="Wholesale" value={row.wholesalePrice} onChange={(e) => updateBulkRow(idx, { wholesalePrice: e.target.value })} />
                    <input type="number" step="0.01" className="input" placeholder="MFG" value={row.costPrice} onChange={(e) => updateBulkRow(idx, { costPrice: e.target.value })} />
                    <label
                      className={`input flex items-center justify-center text-[11px] cursor-pointer ${
                        row.imageFile ? 'text-emerald-700 bg-emerald-50' : 'text-brand-400 hover:text-brand-600'
                      }`}
                    >
                      {row.imageFile ? '✓ Image' : '+ Image'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => selectBulkImage(idx, e.target.files?.[0] ?? null)}
                      />
                    </label>
                    <button type="button" className="text-red-500 text-xs" onClick={() => removeBulkRow(idx)} disabled={bulkRows.length === 1}>
                      Remove
                    </button>
                  </div>
                  {row.imageError && <p className="text-[11px] text-red-600 mt-1">{row.imageError}</p>}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-brand-400">Images: JPG, PNG, or WebP, max 1 MB each.</p>
            <button type="button" className="text-brand-600 text-xs hover:underline" onClick={addBulkRow}>
              + Add another product
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
          title="Delete Product"
          message={`Delete ${deleteTarget.name} from the catalogue?`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function MaterialsTab({ canEdit }: { canEdit: boolean }) {
  const [search, setSearch] = useState('');
  const { data, isLoading, mutate } = useSWR<RawMaterial[]>(`/raw-materials?${new URLSearchParams(search ? { search } : {})}`, fetcher);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyMaterialForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/raw-materials', {
        name: form.name,
        type: form.type || undefined,
        unit: form.unit,
        reorderLevel: form.reorderLevel ? parseFloat(form.reorderLevel) : undefined,
      });
      setFormOpen(false);
      setForm(emptyMaterialForm);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add material');
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
        <input className="input max-w-xs" placeholder="Search material name or type..." value={search} onChange={(e) => setSearch(e.target.value)} />
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
            <button className="btn-primary" onClick={() => setFormOpen(true)}>
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
              <th>Unit</th>
              <th>In Stock</th>
              <th>Min</th>
              <th>Purchase Rate</th>
              <th>Stock Value</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="text-center py-8 text-brand-400">
                  Loading materials...
                </td>
              </tr>
            )}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-8 text-brand-400">
                  No raw materials yet
                </td>
              </tr>
            )}
            {data?.map((m) => (
              <tr key={m.id}>
                <td className="font-medium">{m.name}</td>
                <td>{m.type ?? '-'}</td>
                <td>{m.unit}</td>
                <td>{m.inStock}</td>
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
                  <Link href={`/inventory/materials/${m.id}`} className="text-brand-600 hover:underline text-xs">
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <Modal title="Add Raw Material" onClose={() => setFormOpen(false)}>
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
                <label className="label">Unit</label>
                <input className="input" required value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} placeholder="sheet / cu ft / set" />
              </div>
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
                {submitting ? 'Saving...' : 'Add Material'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

const WORKER_MATERIAL_TABS: { value: WorkerType | ''; label: string }[] = [
  { value: '', label: 'All Materials' },
  { value: 'CARPENTER', label: 'Carpenter Material' },
  { value: 'POLISHER', label: 'Polish Material' },
];

function MovementsTab() {
  const [workerType, setWorkerType] = useState<WorkerType | ''>('');
  const { data, isLoading } = useSWR<StockMovement[]>(
    `/stock-movements${workerType ? `?workerType=${workerType}` : ''}`,
    fetcher,
  );

  const typeChip = (type: string) => {
    if (type === 'IN') return <Chip color="green" label="Stock In" />;
    if (type === 'OUT') return <Chip color="amber" label="Issued" />;
    return <Chip color="blue" label="Adjustment" />;
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b border-brand-200">
        {WORKER_MATERIAL_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setWorkerType(t.value)}
            className={`px-3.5 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              workerType === t.value ? 'border-brand-700 text-brand-900' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="card overflow-x-auto">
      <table className="table-shell">
        <thead>
          <tr>
            <th>Date</th>
            <th>Material</th>
            <th>Type</th>
            <th>Qty</th>
            <th>Reference</th>
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
          {data?.map((m) => (
            <tr key={m.id}>
              <td>{formatDate(m.date)}</td>
              <td>{m.rawMaterial?.name}</td>
              <td>{typeChip(m.type)}</td>
              <td className={m.quantity < 0 ? 'text-red-600' : 'text-emerald-600'}>
                {m.quantity > 0 ? '+' : ''}
                {m.quantity} {m.rawMaterial?.unit}
              </td>
              <td className="text-brand-500">
                {m.workItem ? `Work: ${m.workItem.productName}${m.workItem.carpenter ? ` (${m.workItem.carpenter.name})` : ''}` : m.purchaseOrder ? `PO ${m.purchaseOrder.poNumber}` : '-'}
              </td>
              <td className="text-brand-500">{m.reason ?? '-'}</td>
              <td>{m.createdBy?.name ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
