'use client';

import { FURNITURE_UNITS } from '@/lib/units';

interface UnitSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
  id?: string;
}

// A text input with a suggestion dropdown (native <datalist>) rather than a
// strict <select> - suppliers use trade-specific units the curated list
// won't always cover, so typing a custom value must stay possible.
// Note: <datalist> doesn't support <optgroup> per the HTML spec, so options
// are flat - each label already carries context (e.g. "Sathuram (round/sawn
// log volume)") to make the grouping legible without real grouping markup.
export function UnitSelect({ value, onChange, className, required, id }: UnitSelectProps) {
  const listId = id ? `${id}-units` : 'furniture-units';
  return (
    <>
      <input
        id={id}
        list={listId}
        className={className ?? 'input'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Sathuram, Sheet, Sq.ft"
        required={required}
      />
      <datalist id={listId}>
        {FURNITURE_UNITS.map((u) => (
          <option key={u.value} value={u.value}>
            {u.label}
          </option>
        ))}
      </datalist>
    </>
  );
}
