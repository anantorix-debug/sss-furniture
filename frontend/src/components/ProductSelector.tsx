'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import type { Product } from '@/types';

// Searchable Product Name dropdown for the Customer Order / Party Order
// forms - same portal/position/keyboard-nav pattern as MaterialPicker and
// ModelNoPicker (the field sits inside a scrollable Modal, so a plain
// position:absolute dropdown gets clipped).
//
// Unlike ModelNoPicker (which only lists products that already have a Model
// No. assigned - see its own note), this searches every catalogue product
// by name, SKU, Model No. or category via the existing GET /products?search
// endpoint, so a product can be picked before Production has ever assigned
// it a Model No. Selecting one hands back the full Product so the caller's
// existing selectItemProduct() can auto-fill the rest of the row, exactly
// as it already does when a Model No. is picked via ModelNoPicker.
//
// Typing without selecting a suggestion keeps the typed text as a free-text
// product name (onChangeName) and clears any previously-linked productId
// (same "typing overrides the link" rule already used on this input).
export function ProductSelector({
  value,
  onChangeName,
  onSelect,
  placeholder,
}: {
  value: string;
  onChangeName: (name: string) => void;
  onSelect: (product: Product) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const trimmed = value.trim();

  // Opening the field with nothing typed yet shows every existing product
  // right away, same as ModelNoPicker - typing then narrows it.
  const { data: results } = useSWR<Product[]>(open ? (trimmed ? `/products?search=${encodeURIComponent(trimmed)}` : '/products') : null, fetcher);
  const matches = results ?? [];

  const [highlightIndex, setHighlightIndex] = useState(0);
  useEffect(() => {
    setHighlightIndex(0);
  }, [value, open]);
  useEffect(() => {
    portalRef.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex]);

  function openDropdown() {
    const el = wrapperRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 320) });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const p = matches[highlightIndex];
      if (p) {
        e.preventDefault();
        onSelect(p);
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        className="input"
        placeholder={placeholder ?? 'Search or type Product Name'}
        value={value}
        onChange={(e) => {
          onChangeName(e.target.value);
          if (!open) openDropdown();
        }}
        onFocus={openDropdown}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          setTimeout(() => {
            const active = document.activeElement;
            if (wrapperRef.current?.contains(active) || portalRef.current?.contains(active)) return;
            setOpen(false);
          }, 150);
        }}
      />
      {open &&
        results &&
        rect &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={portalRef}
            className="fixed z-50 bg-white border border-brand-200 rounded-lg shadow-lg max-h-72 overflow-y-auto"
            style={{ top: rect.top, left: rect.left, width: rect.width }}
          >
            {matches.length === 0 ? (
              trimmed ? (
                <p className="px-3 py-2 text-xs text-brand-400 italic">No matching products - this will be saved as a new product name</p>
              ) : (
                <p className="px-3 py-2 text-xs text-brand-400 italic">No products yet</p>
              )
            ) : (
              matches.map((p, idx) => (
                <button
                  key={p.id}
                  type="button"
                  data-highlighted={highlightIndex === idx}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm border-b border-brand-50 last:border-0 ${
                    highlightIndex === idx ? 'bg-brand-50' : 'hover:bg-brand-50'
                  }`}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(p);
                    setOpen(false);
                  }}
                >
                  <span className="font-medium truncate flex-1">{p.name}</span>
                  {p.modelNo && <span className="text-brand-400 text-xs shrink-0">{p.modelNo}</span>}
                  <span className="text-xs shrink-0">
                    {(p.availableQuantity ?? 0) > 0 ? (
                      <span className="text-emerald-700">In Stock</span>
                    ) : (
                      <span className="text-amber-600">Sold</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
