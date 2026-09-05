'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { Modal } from './Modal';
import { ConfirmDialog } from './ConfirmDialog';
import type { Shop } from '@/types';

const emptyForm = { name: '', contactPhone: '', address: '' };

// Shop Name CRUD, embedded directly on the Party Orders page (not tucked
// under Settings) - Super Admin adds/edits/deletes shops here, and the New
// Party Order form's Shop dropdown reads from the same /shops list.
export function ShopManagerModal({ onClose, onChange }: { onClose: () => void; onChange?: () => void }) {
  const [search, setSearch] = useState('');
  const { data: shops, isLoading, mutate } = useSWR<Shop[]>('/shops?includeInactive=true', fetcher);

  const [editing, setEditing] = useState<Shop | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Shop | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setFormOpen(true);
  }
  function openEdit(shop: Shop) {
    setEditing(shop);
    setForm({ name: shop.name, contactPhone: shop.contactPhone ?? '', address: shop.address ?? '' });
    setError(null);
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = { name: form.name, contactPhone: form.contactPhone || undefined, address: form.address || undefined };
      if (editing) {
        await api.patch(`/shops/${editing.id}`, payload);
      } else {
        await api.post('/shops', payload);
      }
      setFormOpen(false);
      mutate();
      onChange?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save shop');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(shop: Shop) {
    await api.patch(`/shops/${shop.id}`, { isActive: !shop.isActive });
    mutate();
    onChange?.();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await api.delete(`/shops/${deleteTarget.id}`);
      setDeleteTarget(null);
      mutate();
      onChange?.();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Failed to delete shop');
    }
  }

  const filtered = (shops ?? []).filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <Modal title="Manage Shops" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input className="input max-w-xs" placeholder="Search shops..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn-primary" onClick={openCreate}>
            + Add Shop
          </button>
        </div>

        <div className="border border-brand-100 rounded-lg overflow-hidden max-h-[50vh] overflow-y-auto">
          {isLoading && <p className="text-center py-6 text-brand-400 text-sm">Loading shops...</p>}
          {!isLoading && filtered.length === 0 && <p className="text-center py-6 text-brand-400 text-sm">No shops found</p>}
          {filtered.map((shop) => (
            <div key={shop.id} className="flex items-center justify-between px-3 py-2.5 border-b border-brand-50 last:border-0">
              <div className="min-w-0">
                <p className={`font-medium truncate ${shop.isActive ? 'text-ink' : 'text-brand-400 line-through'}`}>{shop.name}</p>
                <p className="text-xs text-brand-400 truncate">{[shop.contactPhone, shop.address].filter(Boolean).join(' · ') || '-'}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-xs">
                <button type="button" className="text-brand-600 hover:underline" onClick={() => openEdit(shop)}>
                  Edit
                </button>
                <button type="button" className="text-amber-600 hover:underline" onClick={() => toggleActive(shop)}>
                  {shop.isActive ? 'Disable' : 'Enable'}
                </button>
                <button type="button" className="text-red-600 hover:underline" onClick={() => setDeleteTarget(shop)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {formOpen && (
        <Modal title={editing ? 'Edit Shop' : 'Add Shop'} onClose={() => setFormOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label">Shop Name</label>
              <input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Contact Phone</label>
              <input className="input" value={form.contactPhone} onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))} />
            </div>
            <div>
              <label className="label">Address</label>
              <input className="input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Add Shop'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Shop"
          message={`Delete "${deleteTarget.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
        />
      )}
      {deleteError && <p className="text-sm text-red-600 mt-2">{deleteError}</p>}
    </Modal>
  );
}
