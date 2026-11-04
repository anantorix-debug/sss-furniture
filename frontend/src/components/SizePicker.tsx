'use client';

import { SuggestPicker } from './SuggestPicker';

// The company's common sizes. Anything else can still be typed by hand.
const COMMON_SIZES = [
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

export function SizePicker({ value, onChange, className }: { value: string; onChange: (size: string) => void; className?: string }) {
  return <SuggestPicker options={COMMON_SIZES} label="Size" value={value} onChange={onChange} className={className} />;
}
