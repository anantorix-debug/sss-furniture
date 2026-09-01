'use client';

import { useState } from 'react';
import { api, ApiError, assetUrl, uploadProductImage, validateProductImageFile } from '@/lib/api';
import type { Product } from '@/types';

export function ProductImages({ product, onChange }: { product: Product; onChange: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);

    const validationError = validateProductImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setUploading(true);
    try {
      await uploadProductImage(product.id, file);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to upload image');
    } finally {
      setUploading(false);
    }
  }

  async function removeImage(imageId: string) {
    setError(null);
    try {
      await api.delete(`/products/${product.id}/images/${imageId}`);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove image');
    }
  }

  async function setPrimary(imageId: string) {
    setError(null);
    try {
      await api.patch(`/products/${product.id}/images/${imageId}/primary`);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update primary image');
    }
  }

  return (
    <div>
      <label className="label">Product Images</label>
      <div className="flex flex-wrap gap-3">
        {product.images.map((img) => (
          <div key={img.id} className="relative w-20 h-20 rounded-lg border border-brand-200 overflow-hidden group bg-brand-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assetUrl(img.url) ?? ''} alt={img.fileName} className="w-full h-full object-cover" />
            {img.isPrimary && (
              <span className="absolute top-0.5 left-0.5 bg-brand-700 text-white text-[8px] font-medium px-1 rounded">Main</span>
            )}
            <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-0.5 transition-opacity">
              {!img.isPrimary && (
                <button type="button" className="text-white text-[9px] underline" onClick={() => setPrimary(img.id)}>
                  Set Main
                </button>
              )}
              <button type="button" className="text-red-300 text-[9px] underline" onClick={() => removeImage(img.id)}>
                Remove
              </button>
            </div>
          </div>
        ))}
        <label className="w-20 h-20 rounded-lg border-2 border-dashed border-brand-200 flex items-center justify-center text-brand-400 text-[11px] text-center cursor-pointer hover:border-brand-400 hover:text-brand-600">
          {uploading ? 'Uploading...' : '+ Upload'}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFile} disabled={uploading} />
        </label>
      </div>
      <p className="text-xs text-brand-400 mt-1.5">JPG, PNG, or WebP. Max 1 MB per image. First image uploaded is the main catalogue image.</p>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
