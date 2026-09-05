'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, assetUrl } from '@/lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import type { GalleryImage } from '@/types';

// Images-only visual reference of manufactured furniture - deliberately no
// price/size/finish/pattern/category/quantity shown here (see the schema
// comment on GalleryImage). Reused both as the standalone Inventory Gallery
// tab (canManage=true) and as a picker embedded in the Customer Order form
// (canManage=false, onSend wired to that page's own useWhatsApp() hook).
export function GalleryGrid({
  canManage,
  onSend,
  selectable,
  selectedIds,
  onToggle,
}: {
  canManage: boolean;
  onSend?: (image: GalleryImage) => void;
  // Picker mode (e.g. embedded in the New Customer Order form): renders a
  // checkbox per image and suppresses View/Send/Delete, instead of the
  // standalone Gallery tab's click-to-send behavior.
  selectable?: boolean;
  selectedIds?: string[];
  onToggle?: (image: GalleryImage) => void;
}) {
  const { data: images, isLoading, mutate } = useSWR<GalleryImage[]>('/gallery', fetcher);
  const [deleteTarget, setDeleteTarget] = useState<GalleryImage | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await api.delete(`/gallery/${deleteTarget.id}`);
      setDeleteTarget(null);
      mutate();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Failed to delete image');
    }
  }

  if (isLoading) return <p className="text-brand-400 text-sm">Loading gallery...</p>;
  if (!images || images.length === 0) return <p className="text-brand-400 text-sm">No images uploaded yet.</p>;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {images.map((img) => {
          const selected = selectable && (selectedIds ?? []).includes(img.id);
          return (
            <div
              key={img.id}
              className={`card p-2 space-y-2 ${selectable ? 'cursor-pointer' : ''} ${selected ? 'ring-2 ring-brand-600' : ''}`}
              onClick={selectable ? () => onToggle?.(img) : undefined}
            >
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={assetUrl(img.url) ?? ''} alt={img.caption ?? img.fileName} className="w-full aspect-square object-cover rounded-md border border-brand-100" />
                {selectable && (
                  <span
                    className={`absolute top-1.5 right-1.5 h-5 w-5 rounded-full border-2 flex items-center justify-center text-[11px] ${
                      selected ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white/80 border-brand-300'
                    }`}
                  >
                    {selected ? '✓' : ''}
                  </span>
                )}
              </div>
              {img.modelNo && <p className="text-[11px] text-brand-500 truncate">{img.modelNo}</p>}
              {!selectable && (
                <div className="flex flex-wrap gap-x-2 gap-y-1 text-[11px]">
                  <a href={assetUrl(img.url) ?? '#'} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                    View
                  </a>
                  {onSend && (
                    <button type="button" className="text-emerald-700 hover:underline" onClick={() => onSend(img)}>
                      Send WhatsApp
                    </button>
                  )}
                  {canManage && (
                    <button type="button" className="text-red-600 hover:underline" onClick={() => setDeleteTarget(img)}>
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Image"
          message={`Delete this image (${deleteTarget.fileName})? This cannot be undone.`}
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
    </>
  );
}
