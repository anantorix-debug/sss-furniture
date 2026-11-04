'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// The company's common sizes. Anything else can still be typed by hand.
export const COMMON_SIZES = [
  '3FT',
  '4FT',
  '5FT',
  '6FT',
  '7FT',
  '75 x 48',
  '75 x 60',
  '75 x 72',
  '78 x 60',
  '78 x 67',
  '78 x 72',
  '84 x 72',
  '4 x 3',
  '5 x 3',
  '6 x 3',
  '6 x 4',
];

// 78x72, 78*72 and "78 x 72" all count as the same size when searching.
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]|x(?=\s*\d)/g, '');

// Searchable Size box: same portal pattern as ProductSelector, because the
// field sits inside a scrollable Modal that would clip a normal dropdown.
export function SizePicker({
  value,
  onChange,
  placeholder = 'Size (search or type)',
  className = 'input',
}: {
  value: string;
  onChange: (size: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);

  // Clicking into a filled box shows every size, so it is easy to change.
  // The list narrows only once the person starts typing.
  const query = squash(value);
  const matches = typing && query ? COMMON_SIZES.filter((s) => squash(s).includes(query)) : COMMON_SIZES;

  function openDropdown() {
    const r = wrapperRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 180) });
    setOpen(true);
  }

  function choose(size: string) {
    onChange(size);
    setTyping(false);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (portalRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  useEffect(() => {
    portalRef.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && matches[highlight]) {
      // Only an option picked with the arrows; Enter never replaces typed text.
      e.preventDefault();
      choose(matches[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        className={className}
        placeholder={placeholder}
        aria-label="Size"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setTyping(true);
          setHighlight(-1);
          if (!open) openDropdown();
        }}
        onFocus={() => {
          setTyping(false);
          setHighlight(-1);
          openDropdown();
        }}
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
            className="fixed z-50 bg-white border border-brand-200 rounded-lg shadow-lg max-h-60 overflow-y-auto"
            style={{ top: rect.top, left: rect.left, width: rect.width }}
          >
            {matches.length === 0 ? (
              <p className="px-3 py-2 text-xs text-brand-400 italic">Not in the list - this size will be saved as typed</p>
            ) : (
              matches.map((size, idx) => (
                <button
                  key={size}
                  type="button"
                  data-highlighted={highlight === idx}
                  className={`w-full px-3 py-2 text-left text-sm font-medium border-b border-brand-50 last:border-0 ${
                    highlight === idx ? 'bg-brand-50' : 'hover:bg-brand-50'
                  }`}
                  onMouseEnter={() => setHighlight(idx)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(size)}
                >
                  {size}
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
