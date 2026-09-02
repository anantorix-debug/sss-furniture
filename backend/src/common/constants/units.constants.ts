// Suggested units for raw-material stock and supplier purchase entries in a
// wood/furniture manufacturing business. Deliberately a curated list for UI
// dropdowns, not a DB enum - unit fields stay free-text (see RawMaterial.unit,
// SupplierPurchase.unit) because trade-specific units vary by supplier and a
// hard enum would need a migration every time an uncommon one comes up.
export interface UnitOption {
  value: string;
  label: string;
  /** Which kind of material this unit is typically used for - drives grouping in the dropdown. */
  group: 'timber' | 'sheet' | 'hardware' | 'finish' | 'general';
}

export const FURNITURE_UNITS: UnitOption[] = [
  // Timber / wood, sold by traditional volume or length measures
  { value: 'Sathuram', label: 'Sathuram (சதுரம் - round/sawn log volume)', group: 'timber' },
  { value: 'Cu.ft', label: 'Cu.ft (cubic feet)', group: 'timber' },
  { value: 'Rft', label: 'Rft (running feet)', group: 'timber' },
  { value: 'Sq.ft', label: 'Sq.ft (square feet)', group: 'timber' },
  { value: 'Log', label: 'Log', group: 'timber' },

  // Sheet materials - plywood, chipboard, MDF, laminate
  { value: 'Sheet', label: 'Sheet', group: 'sheet' },
  { value: 'Board', label: 'Board', group: 'sheet' },

  // Hardware & fittings
  { value: 'Box', label: 'Box', group: 'hardware' },
  { value: 'Packet', label: 'Packet', group: 'hardware' },
  { value: 'Roll', label: 'Roll', group: 'hardware' },
  { value: 'Set', label: 'Set', group: 'hardware' },
  { value: 'Pair', label: 'Pair', group: 'hardware' },
  { value: 'Nos', label: 'Nos (numbers/pieces)', group: 'hardware' },

  // Polish / finishing materials - liquids & powders
  { value: 'Litre', label: 'Litre', group: 'finish' },
  { value: 'Kg', label: 'Kg', group: 'finish' },
  { value: 'Gram', label: 'Gram', group: 'finish' },
  { value: 'Tin', label: 'Tin', group: 'finish' },

  // General fallback
  { value: 'Bag', label: 'Bag', group: 'general' },
  { value: 'Meter', label: 'Meter', group: 'general' },
  { value: 'Inch', label: 'Inch', group: 'general' },
];

export const FURNITURE_UNIT_VALUES = FURNITURE_UNITS.map((u) => u.value);
