'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { COMPANY_PRODUCTS, type CompanyProductEntry } from '@/lib/companyProducts';

// Searchable Product Name dropdown for the Customer Order / Party Order
// forms - same portal/position/keyboard-nav pattern as MaterialPicker and
// ModelNoPicker (the field sits inside a scrollable Modal, so a plain
// position:absolute dropdown gets clipped).
//
// Deliberately NOT backed by the live /products search (that table holds
// one row per individual physical stock piece, each already carrying its
// own real Model No. and almost always "Sold" - a confusing source for
// "what product names exist"). This instead searches the static
// COMPANY_PRODUCTS reference list taken from the company's own work-list
// sheets. Selecting one fills in Product Name / Category / Size / Unit
// Price where the calling form has that field; it never sets a Model No. -
// that stays exactly as today (unassigned until Production enters it, or
// picked separately via the existing Catalog Model No. search).
//
// Typing without selecting a suggestion keeps the typed text as a free-text
// product name and clears any previously-linked productId, same as before.
export function ProductSelector({
  value,
  onChangeName,
  onSelect,
  placeholder,
}: {
  value: string;
  onChangeName: (name: string) => void;
  onSelect: (entry: CompanyProductEntry) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const trimmed = value.trim().toLowerCase();

  const matches = trimmed
    ? COMPANY_PRODUCTS.filter((p) => p.name.toLowerCase().includes(trimmed) || p.category.toLowerCase().includes(trimmed))
    : COMPANY_PRODUCTS;

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
        rect &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={portalRef}
            className="fixed z-50 bg-white border border-brand-200 rounded-lg shadow-lg max-h-72 overflow-y-auto"
            style={{ top: rect.top, left: rect.left, width: rect.width }}
          >
            {matches.length === 0 ? (
              <p className="px-3 py-2 text-xs text-brand-400 italic">No matching products - this will be saved as a new product name</p>
            ) : (
              matches.map((p, idx) => (
                <button
                  key={`${p.name}-${p.category}-${p.size ?? ''}-${p.price}-${idx}`}
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
                  <span className="text-brand-400 text-xs shrink-0">
                    {p.category}
                    {p.size ? ` - ${p.size}` : ''}
                  </span>
                  <span className="text-xs shrink-0 text-brand-600">₹{p.price}</span>
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
