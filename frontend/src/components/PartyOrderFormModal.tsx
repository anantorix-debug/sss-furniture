'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { formatCurrency, toDateInputValue } from '@/lib/format';
import { Modal } from './Modal';
import { FormRow, FormField } from './orders/OrderFormFields';
import { ModelNoPicker } from './ModelNoPicker';
import { GalleryGrid } from './GalleryGrid';
import { assetUrl } from '@/lib/api';
import type { PartyOrder, PartyOrderItem, DeliveryStatus, Shop, Product, GalleryImage } from '@/types';

interface ItemForm {
  productId?: string;
  productName: string;
  finish: string;
  color: string;
  pattern: string;
  details: string;
  qty: string;
  unitPrice: string;
  modelNo?: string;
  availableQuantity?: number;
  referenceImageId?: string;
  referenceImage?: GalleryImage | null;
}

const emptyItem: ItemForm = {
  productName: '',
  finish: '',
  color: '',
  pattern: '',
  details: '',
  qty: '1',
  unitPrice: '',
};

const emptyForm = {
  orderDate: new Date().toISOString().slice(0, 10),
  shopId: '',
  phone: '',
  courierTrack: '',
  actualDeliveryDate: '',
  deliveryStatus: 'PENDING' as DeliveryStatus,
};

function itemFromExisting(i: PartyOrderItem): ItemForm {
  return {
    productId: i.productId ?? undefined,
    productName: i.productName,
    finish: i.finish ?? '',
    color: i.color ?? '',
    pattern: i.pattern ?? '',
    details: i.details ?? '',
    qty: String(i.qty),
    unitPrice: String(i.unitPrice ?? 0),
    modelNo: i.modelNo ?? undefined,
    referenceImageId: i.referenceImageId ?? undefined,
    referenceImage: i.referenceImage ?? null,
  };
}

// Create/edit form for a Party Order - shared by the list page's "+ New
// Party Order" / card "Edit" action and the detail page's "Edit" button,
// so the (fairly large) multi-product form only exists in one place.
export function PartyOrderFormModal({ editing, onClose, onSaved }: { editing: PartyOrder | null; onClose: () => void; onSaved: () => void }) {
  const { data: shops } = useSWR<Shop[]>('/shops', fetcher);
  const [form, setForm] = useState(
    editing
      ? {
          orderDate: toDateInputValue(editing.orderDate),
          shopId: editing.shopId ?? '',
          phone: editing.phone ?? '',
          courierTrack: editing.courierTrack ?? '',
          actualDeliveryDate: toDateInputValue(editing.actualDeliveryDate),
          deliveryStatus: editing.deliveryStatus,
        }
      : emptyForm,
  );
  const [items, setItems] = useState<ItemForm[]>(
    editing && editing.items.length > 0 ? editing.items.map(itemFromExisting) : [{ ...emptyItem }],
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [itemImagePickerIdx, setItemImagePickerIdx] = useState<number | null>(null);

  function updateItem(idx: number, patch: Partial<ItemForm>) {
    setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function setItemImage(idx: number, image: GalleryImage | null) {
    updateItem(idx, { referenceImageId: image?.id, referenceImage: image });
  }
  function addItem() {
    setItems((rows) => [...rows, { ...emptyItem }]);
  }
  function removeItem(idx: number) {
    setItems((rows) => rows.filter((_, i) => i !== idx));
  }
  function selectItemProduct(idx: number, product: Product | null) {
    if (!product) {
      updateItem(idx, { productId: undefined, availableQuantity: undefined });
      return;
    }
    updateItem(idx, {
      productId: product.id,
      productName: product.name,
      finish: product.materialFinish ?? '',
      pattern: product.pattern ?? '',
      details: product.details ?? '',
      unitPrice: String(product.retailPrice ?? 0),
      modelNo: product.modelNo ?? undefined,
      availableQuantity: product.availableQuantity,
    });
  }

  const orderTotal = items.reduce((sum, i) => sum + (parseInt(i.qty, 10) || 1) * (parseFloat(i.unitPrice) || 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const validItems = items.filter((i) => i.productName.trim());
    if (validItems.length === 0) {
      setFormError('Add at least one product line');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        orderDate: form.orderDate,
        shopId: form.shopId,
        phone: form.phone || undefined,
        courierTrack: form.courierTrack || undefined,
        actualDeliveryDate: form.actualDeliveryDate || undefined,
        deliveryStatus: form.deliveryStatus,
        items: validItems.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          finish: i.finish || undefined,
          color: i.color || undefined,
          pattern: i.pattern || undefined,
          details: i.details || undefined,
          qty: parseInt(i.qty, 10) || 1,
          unitPrice: parseFloat(i.unitPrice) || 0,
          modelNo: i.modelNo || undefined,
          referenceImageId: i.referenceImageId || undefined,
        })),
      };
      if (editing) {
        await api.patch(`/party-orders/${editing.id}`, payload);
      } else {
        await api.post('/party-orders', payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save order');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={editing ? 'Edit Party Order' : 'New Party Order'} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormRow>
          <FormField label="Order Date">
            <input
              type="date"
              className="input"
              required
              value={form.orderDate}
              onChange={(e) => setForm((f) => ({ ...f, orderDate: e.target.value }))}
            />
          </FormField>
          <FormField label="Shop">
            <select className="input" required value={form.shopId} onChange={(e) => setForm((f) => ({ ...f, shopId: e.target.value }))}>
              <option value="">Select shop...</option>
              {shops?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FormField>
        </FormRow>
        <FormField label="Phone">
          <input className="input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </FormField>

        <div className="border-t border-brand-100 pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-brand-900">Products</h3>
            <button type="button" className="text-brand-600 text-xs hover:underline" onClick={addItem}>
              + Add Product
            </button>
          </div>
          <div className="space-y-3 max-h-[45vh] overflow-y-auto">
            {items.map((item, idx) => (
              <div key={idx} className="border border-brand-100 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr_auto] gap-2 items-start">
                  <ModelNoPicker
                    modelNo={item.modelNo ?? ''}
                    onChangeModelNo={(v) => updateItem(idx, { modelNo: v })}
                    onSelect={(p) => selectItemProduct(idx, p)}
                  />
                  <input
                    className="input"
                    placeholder="Product Name"
                    value={item.productName}
                    onChange={(e) => updateItem(idx, { productName: e.target.value, productId: undefined })}
                  />
                  <button
                    type="button"
                    className="text-red-500 text-xs px-2 py-2"
                    onClick={() => removeItem(idx)}
                    disabled={items.length === 1}
                  >
                    Remove
                  </button>
                </div>
                {item.productId && <p className="text-[11px] text-emerald-700">From Godown Stock - In Stock</p>}
                <div className="grid grid-cols-2 gap-2">
                  <input className="input text-sm" placeholder="Finish" value={item.finish} onChange={(e) => updateItem(idx, { finish: e.target.value })} />
                  <input className="input text-sm" placeholder="Pattern" value={item.pattern} onChange={(e) => updateItem(idx, { pattern: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input text-sm" placeholder="Details" value={item.details} onChange={(e) => updateItem(idx, { details: e.target.value })} />
                  <input
                    className="input text-sm"
                    placeholder="Polish Colour (e.g. Walnut Brown)"
                    value={item.color}
                    onChange={(e) => updateItem(idx, { color: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 items-center">
                  <div>
                    <label className="text-[10px] text-brand-400">Qty</label>
                    <input type="number" min="1" className="input text-sm" value={item.qty} onChange={(e) => updateItem(idx, { qty: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-[10px] text-brand-400">Unit Price</label>
                    <input type="number" min="0" step="0.01" className="input text-sm" value={item.unitPrice} onChange={(e) => updateItem(idx, { unitPrice: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-[10px] text-brand-400">Line Total</label>
                    <div className="input text-sm bg-brand-50 text-brand-700 font-medium flex items-center">
                      {formatCurrency((parseInt(item.qty, 10) || 1) * (parseFloat(item.unitPrice) || 0))}
                    </div>
                  </div>
                </div>
                {item.modelNo && <p className="text-[11px] text-brand-500">Model No: {item.modelNo}</p>}
                <div className="flex items-center gap-2">
                  {item.referenceImage ? (
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={assetUrl(item.referenceImage.url) ?? ''}
                        alt={item.referenceImage.fileName}
                        className="h-12 w-12 object-cover rounded-md border border-brand-200"
                      />
                      <button
                        type="button"
                        className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white text-[11px] leading-none"
                        onClick={() => setItemImage(idx, null)}
                      >
                        ×
                      </button>
                    </div>
                  ) : null}
                  <button type="button" className="btn-secondary text-xs px-2 py-1" onClick={() => setItemImagePickerIdx(idx)}>
                    {item.referenceImage ? 'Change Image' : '+ Add Image'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <p className="text-sm font-semibold text-brand-900">Total Order Value: {formatCurrency(orderTotal)}</p>
          </div>
        </div>

        <FormRow>
          <FormField label="Vehicle Number">
            <input
              className="input"
              value={form.courierTrack}
              onChange={(e) => setForm((f) => ({ ...f, courierTrack: e.target.value }))}
              placeholder="TN 30 AB 1234"
            />
          </FormField>
          <FormField label="Actual Delivery Date">
            <input
              type="date"
              className="input"
              value={form.actualDeliveryDate}
              onChange={(e) => setForm((f) => ({ ...f, actualDeliveryDate: e.target.value }))}
            />
          </FormField>
        </FormRow>
        <FormField label="Delivery Status">
          <select
            className="input"
            value={form.deliveryStatus}
            onChange={(e) => setForm((f) => ({ ...f, deliveryStatus: e.target.value as DeliveryStatus }))}
          >
            <option value="PENDING">Pending</option>
            <option value="DELIVERED">Delivered</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </FormField>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Create Order'}
          </button>
        </div>
      </form>

      {itemImagePickerIdx !== null && (
        <Modal title="Select Product Image" onClose={() => setItemImagePickerIdx(null)} wide>
          <GalleryGrid
            canManage={false}
            selectable
            selectedIds={items[itemImagePickerIdx]?.referenceImageId ? [items[itemImagePickerIdx].referenceImageId as string] : []}
            onToggle={(image) => {
              setItemImage(itemImagePickerIdx, image);
              setItemImagePickerIdx(null);
            }}
          />
          <div className="flex justify-end pt-3">
            <button type="button" className="btn-secondary text-sm" onClick={() => setItemImagePickerIdx(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
