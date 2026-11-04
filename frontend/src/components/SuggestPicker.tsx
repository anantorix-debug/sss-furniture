'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// 78x72, 78*72 and "78 x 72" all count as the same when searching.
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]|x(?=\s*\d)/g, '');
// First letters of each word, so TG finds TEAK GLOSSY.
const initials = (s: string) => s.split(/\s+/).map((w) => w[0] ?? '').join('').toLowerCase();

// A text box with a searchable list of common values. Anything else can still
// be typed by hand. Same portal pattern as ProductSelector, because these sit
// inside scrollable Modals that would clip a normal dropdown.
export function SuggestPicker({
  options,
  value,
  onChange,
  label,
  placeholder,
  className = 'input',
  required,
  autoFocus,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);

  // Clicking into a filled box shows every option, so it is easy to change.
  // The list narrows only once the person starts typing.
  const query = squash(value);
  const matches = typing && query ? options.filter((o) => squash(o).includes(query) || initials(o).startsWith(query)) : options;

  function openDropdown() {
    const r = wrapperRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 180) });
    setOpen(true);
  }

  function choose(option: string) {
    onChange(option);
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
        placeholder={placeholder ?? `${label} (search or type)`}
        aria-label={label}
        autoComplete="off"
        required={required}
        autoFocus={autoFocus}
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
              <p className="px-3 py-2 text-xs text-brand-400 italic">Not in the list - this will be saved as typed</p>
            ) : (
              matches.map((option, idx) => (
                <button
                  key={option}
                  type="button"
                  data-highlighted={highlight === idx}
                  className={`w-full px-3 py-2 text-left text-sm font-medium border-b border-brand-50 last:border-0 ${
                    highlight === idx ? 'bg-brand-50' : 'hover:bg-brand-50'
                  }`}
                  onMouseEnter={() => setHighlight(idx)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(option)}
                >
                  {option}
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
