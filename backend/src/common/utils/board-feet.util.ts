import { BadRequestException } from '@nestjs/common';

// Standard timber-industry board-foot formula: Thickness(in) x Width(in) x
// Length(ft) / 12 per piece, x number of pieces. Length is in FEET, not
// inches - matching how timber is actually quoted/measured on site (the
// equivalent all-inches formula would divide by 144 instead; dividing by 12
// here already accounts for length being 12x "shorter" in feet than inches).
// The one place this formula lives - callers recompute from stored
// dimensions rather than trusting a client-sent total, so the number is
// enforced consistently no matter which client/service calls it.
export function computeBoardFeet(d: { thicknessIn?: number; widthIn?: number; lengthFt?: number; pieces?: number }): number {
  const { thicknessIn, widthIn, lengthFt, pieces } = d;
  if (thicknessIn == null || widthIn == null || lengthFt == null || pieces == null) {
    throw new BadRequestException('Thickness, width, length and number of pieces are all required for a board-feet material');
  }
  if (thicknessIn <= 0 || widthIn <= 0 || lengthFt <= 0 || pieces <= 0) {
    throw new BadRequestException('Thickness, width, length and pieces must be positive numbers');
  }
  return Math.round(((thicknessIn * widthIn * lengthFt) / 12) * pieces * 100) / 100;
}
