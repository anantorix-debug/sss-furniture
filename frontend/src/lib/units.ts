// Suggested units for raw-material stock and supplier purchase entries in a
// wood/furniture manufacturing business. Mirrors backend/src/common/constants/
// units.constants.ts. A curated dropdown list, not a hard restriction - the
// underlying fields stay free text so an uncommon supplier-specific unit can
// still be typed in.
export interface UnitOption {
  value: string;
  label: string;
  group: 'timber' | 'sheet' | 'hardware' | 'finish' | 'general';
}

export const FURNITURE_UNITS: UnitOption[] = [
  { value: 'Sathuram', label: 'Sathuram (சதுரம் - round/sawn log volume)', group: 'timber' },
  { value: 'Cu.ft', label: 'Cu.ft (cubic feet)', group: 'timber' },
  { value: 'Rft', label: 'Rft (running feet)', group: 'timber' },
  { value: 'Sq.ft', label: 'Sq.ft (square feet)', group: 'timber' },
  { value: 'Log', label: 'Log', group: 'timber' },

  { value: 'Sheet', label: 'Sheet', group: 'sheet' },
  { value: 'Board', label: 'Board', group: 'sheet' },

  { value: 'Box', label: 'Box', group: 'hardware' },
  { value: 'Packet', label: 'Packet', group: 'hardware' },
  { value: 'Roll', label: 'Roll', group: 'hardware' },
  { value: 'Set', label: 'Set', group: 'hardware' },
  { value: 'Pair', label: 'Pair', group: 'hardware' },
  { value: 'Nos', label: 'Nos (numbers/pieces)', group: 'hardware' },

  { value: 'Litre', label: 'Litre', group: 'finish' },
  { value: 'Kg', label: 'Kg', group: 'finish' },
  { value: 'Gram', label: 'Gram', group: 'finish' },
  { value: 'Tin', label: 'Tin', group: 'finish' },

  { value: 'Bag', label: 'Bag', group: 'general' },
  { value: 'Meter', label: 'Meter', group: 'general' },
  { value: 'Inch', label: 'Inch', group: 'general' },
];

export const UNIT_GROUP_LABELS: Record<UnitOption['group'], string> = {
  timber: 'Timber / Wood',
  sheet: 'Sheet Material',
  hardware: 'Hardware & Fittings',
  finish: 'Polish & Finishing',
  general: 'General',
};
