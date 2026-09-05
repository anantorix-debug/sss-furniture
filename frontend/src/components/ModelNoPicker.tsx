'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import type { Product } from '@/types';

// Model No.-only search/autocomplete (separate from the Product Name
// field). Typing "20" surfaces every stock Model No. containing "20"
// (205, 207, 220, ...); selecting one hands back the full Product so the
// caller can auto-fill Product/Finish/Size/Size Unit/Pattern/Details/Price.
// A Model No. with no match is treated as brand new - the caller keeps
// whatever was typed and lets the rest of the line be entered manually.
//
// The dropdown is rendered through a portal into document.body with
// position:fixed, computed from the input's own bounding rect - it sits
// inside a scrollable Modal (and, on the Party Order form, a second nested
// scrollable product-list), and a plain position:absolute dropdown gets
// clipped by those ancestors' overflow instead of floating freely and
// scrolling on its own.
export function ModelNoPicker({
  modelNo,
  onChangeModelNo,
  onSelect,
  placeholder,
}: {
  modelNo: string;
  onChangeModelNo: (value: string) => void;
  onSelect: (product: Product | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const trimmed = modelNo.trim();
  // Opening the field (even with nothing typed yet) shows every existing
  // Model No. right away - typing then narrows it, rather than requiring a
  // keystroke before anything appears.
  const { data: results } = useSWR<Product[]>(open ? (trimmed ? `/products?search=${encodeURIComponent(trimmed)}` : '/products') : null, fetcher);
  const matches = (results ?? []).filter((p) => p.modelNo && (!trimmed || p.modelNo.toLowerCase().includes(trimmed.toLowerCase())));

  function openDropdown() {
    const el = wrapperRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      // Never narrower than the input, but wide enough to fit "Model No -
      // Product Name - In Stock" on one line - the field itself is often a
      // narrow ~140px column, which was squeezing that row onto 2-3 lines
      // and making the list look broken/unscrollable.
      setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 320) });
    }
    setOpen(true);
  }

  // Closes on scroll/resize anywhere on the page rather than trying to
  // re-track position live - simplest way to never show a stale-positioned
  // dropdown while a scrollable ancestor moves underneath it.
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

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        className="input"
        placeholder={placeholder ?? 'Model No.'}
        value={modelNo}
        onChange={(e) => {
          onChangeModelNo(e.target.value);
          onSelect(null);
          openDropdown();
        }}
        onFocus={openDropdown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open &&
        results &&
        rect &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed z-50 bg-white border border-brand-200 rounded-lg shadow-lg max-h-52 overflow-y-auto"
            style={{ top: rect.top, left: rect.left, width: rect.width }}
          >
            {matches.length === 0 ? (
              trimmed ? (
                <p className="px-3 py-2 text-xs text-amber-600 italic">New Model - no existing stock details found</p>
              ) : (
                <p className="px-3 py-2 text-xs text-brand-400 italic">No stock models yet</p>
              )
            ) : (
              matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50 border-b border-brand-50 last:border-0"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChangeModelNo(p.modelNo ?? '');
                    onSelect(p);
                    setOpen(false);
                  }}
                >
                  <span className="font-medium shrink-0">{p.modelNo}</span>
                  <span className="text-brand-400 text-xs truncate flex-1">{p.name}</span>
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
