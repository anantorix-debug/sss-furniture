'use client';

import { useState } from 'react';
import { FURNITURE_UNITS, UNIT_GROUP_LABELS, type UnitOption } from '@/lib/units';

interface UnitSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
  id?: string;
}

const GROUPS: UnitOption['group'][] = ['timber', 'sheet', 'hardware', 'finish', 'general'];
const CUSTOM = '__custom__';

// A real <select> rather than a text input + <datalist> - datalist's
// suggestion popup doesn't render on mobile Safari (iPad/iPhone), which made
// this control look like a plain, empty text box with no visible options on
// tablets. A <select> always renders its options everywhere. "Other" reveals
// a free-text input for the trade-specific units the curated list won't cover.
export function UnitSelect({ value, onChange, className, required, id }: UnitSelectProps) {
  const knownValues = FURNITURE_UNITS.map((u) => u.value);
  const [customMode, setCustomMode] = useState(() => value !== '' && !knownValues.includes(value));

  if (customMode) {
    return (
      <div className="flex gap-2">
        <input
          id={id}
          className={className ?? 'input'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Sathuram, Sheet, Sq.ft"
          required={required}
        />
        <button
          type="button"
          className="text-xs text-brand-600 hover:underline whitespace-nowrap"
          onClick={() => {
            setCustomMode(false);
            onChange('');
          }}
        >
          Choose from list
        </button>
      </div>
    );
  }

  return (
    <select
      id={id}
      className={className ?? 'input'}
      value={value}
      required={required}
      onChange={(e) => {
        if (e.target.value === CUSTOM) {
          setCustomMode(true);
          onChange('');
        } else {
          onChange(e.target.value);
        }
      }}
    >
      <option value="">Select unit</option>
      {GROUPS.map((group) => (
        <optgroup key={group} label={UNIT_GROUP_LABELS[group]}>
          {FURNITURE_UNITS.filter((u) => u.group === group).map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </optgroup>
      ))}
      <option value={CUSTOM}>Other (type manually)...</option>
    </select>
  );
}
