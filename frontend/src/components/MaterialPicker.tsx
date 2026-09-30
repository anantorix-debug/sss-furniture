'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import type { RawMaterial, MaterialGroup, MaterialMeasurementKind } from '@/types';

// Searchable replacement for the raw-material <select> on the Purchase form
// - same portal/position pattern as ModelNoPicker (the field sits inside a
// scrollable Modal, so a plain position:absolute dropdown gets clipped).
// Also folds in a "+ Add Material" inline form so a brand-new material can
// be created without leaving the Purchase form - it posts to the same
// /raw-materials endpoint the Inventory > Raw Material Stock page already
// reads from, and calls mutate() on that shared SWR key so both this
// dropdown and that page pick it up immediately.
export function MaterialPicker({ value, onSelect }: { value: string; onSelect: (material: RawMaterial) => void }) {
  const { data: materials, mutate } = useSWR<RawMaterial[]>('/raw-materials', fetcher);
  const selected = materials?.find((m) => m.id === value) ?? null;

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'list' | 'add'>('list');
  const [query, setQuery] = useState('');
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim().toLowerCase();
  const matches = (materials ?? []).filter((m) => !trimmed || m.name.toLowerCase().includes(trimmed));

  function openDropdown() {
    const el = wrapperRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 320) });
    }
    setMode('list');
    setQuery('');
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

  const [form, setForm] = useState({ name: '', materialGroup: 'WOOD' as MaterialGroup, measurementKind: 'OTHER' as MaterialMeasurementKind, unit: '', reorderLevel: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitNewMaterial() {
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const created = await api.post<RawMaterial>('/raw-materials', {
        name: form.name.trim(),
        materialGroup: form.materialGroup,
        measurementKind: form.measurementKind,
        unit: form.measurementKind === 'OTHER' ? form.unit || undefined : undefined,
        reorderLevel: form.reorderLevel ? parseFloat(form.reorderLevel) : undefined,
      });
      await mutate();
      onSelect(created);
      setForm({ name: '', materialGroup: 'WOOD', measurementKind: 'OTHER', unit: '', reorderLevel: '' });
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add material');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        ref={inputRef}
        className="input"
        placeholder="Select material"
        value={open ? query : selected ? `${selected.name} (${selected.unit})` : ''}
        onChange={(e) => {
          setQuery(e.target.value);
          setMode('list');
          if (!open) openDropdown();
          else setOpen(true);
        }}
        onFocus={openDropdown}
        onBlur={() => {
          // The "+ Add Material" form's own inputs live in the portal, not
          // inside wrapperRef (document.body, not a DOM descendant) - a
          // blind blur-close would slam the dropdown shut the instant the
          // user tabs/clicks into the Name/Unit/Reorder fields. Checking
          // where focus actually landed (after the click's focus change has
          // settled) keeps it open for anything inside either the input
          // wrapper or the portalled popup.
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
            {mode === 'list' ? (
              <>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50 border-b border-brand-100"
                  onClick={() => setMode('add')}
                >
                  + Add Material
                </button>
                {matches.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-brand-400 italic">No materials match</p>
                ) : (
                  matches.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50 border-b border-brand-50 last:border-0"
                      onClick={() => {
                        onSelect(m);
                        setOpen(false);
                      }}
                    >
                      <span className="font-medium truncate flex-1">{m.name}</span>
                      <span className="text-brand-400 text-xs shrink-0">{m.unit}</span>
                    </button>
                  ))
                )}
              </>
            ) : (
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-brand-900">New Material</p>
                  <button type="button" className="text-xs text-brand-400 hover:underline" onClick={() => setMode('list')}>
                    Back
                  </button>
                </div>
                <input
                  className="input text-sm"
                  placeholder="Name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitNewMaterial();
                    }
                  }}
                  autoFocus
                />
                <div className="grid grid-cols-2 gap-2">
                  <select className="input text-sm" value={form.materialGroup} onChange={(e) => setForm((f) => ({ ...f, materialGroup: e.target.value as MaterialGroup }))}>
                    <option value="WOOD">Wood</option>
                    <option value="CARVING">Carving</option>
                    <option value="POLISH">Polish</option>
                    <option value="OTHER">Other</option>
                  </select>
                  <select
                    className="input text-sm"
                    value={form.measurementKind}
                    onChange={(e) => setForm((f) => ({ ...f, measurementKind: e.target.value as MaterialMeasurementKind }))}
                  >
                    <option value="BOARD_FEET">Board Feet</option>
                    <option value="SHEET">Sheet</option>
                    <option value="LIQUID">Liquid</option>
                    <option value="COUNT">Count</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                {form.measurementKind === 'OTHER' && (
                  <input className="input text-sm" placeholder="Unit (e.g. Kg, Box)" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} />
                )}
                <input
                  className="input text-sm"
                  placeholder="Reorder Level (optional)"
                  type="number"
                  value={form.reorderLevel}
                  onChange={(e) => setForm((f) => ({ ...f, reorderLevel: e.target.value }))}
                />
                {error && <p className="text-xs text-red-600">{error}</p>}
                <button type="button" className="btn-primary text-sm w-full" disabled={saving} onClick={submitNewMaterial}>
                  {saving ? 'Saving...' : 'Save Material'}
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
