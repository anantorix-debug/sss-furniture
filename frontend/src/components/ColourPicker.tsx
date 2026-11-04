'use client';

import { SuggestPicker } from './SuggestPicker';

// The company's common polish colours, taken from its orders. Searching by first
// letters works too (TG finds TEAK GLOSSY), and any other colour can be typed.
const COMMON_COLOURS = [
  'TEAK GLOSSY',
  'TEAK SEMI GLOSSY',
  'TEAK NATURAL',
  'TEAK FINISH',
  'TEAK POLISH',
  'TEAK WALNUT',
  'TEAK DARK FINISH',
  'ROSE WOOD',
  'REAL WOOD',
  'WALNUT FINISH',
  'CHOCOLATE',
  'DARK CHOCOLATE',
  'WHITE',
  'RED',
  'BAMBOO FABRIC',
];

export function ColourPicker({
  value,
  onChange,
  className,
  required,
  autoFocus,
}: {
  value: string;
  onChange: (colour: string) => void;
  className?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <SuggestPicker
      options={COMMON_COLOURS}
      label="Polish Colour"
      value={value}
      onChange={onChange}
      className={className}
      required={required}
      autoFocus={autoFocus}
    />
  );
}
