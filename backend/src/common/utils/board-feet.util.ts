import { BadRequestException } from '@nestjs/common';

// Standard board-foot formula for raw wood/timber: Thickness x Width x
// Length / 144 per piece, x number of pieces. All dimensions in inches.
// The one place this formula lives - callers recompute from stored
// dimensions rather than trusting a client-sent total, so the number is
// enforced consistently no matter which client/service calls it.
export function computeBoardFeet(d: { thicknessIn?: number; widthIn?: number; lengthIn?: number; pieces?: number }): number {
  const { thicknessIn, widthIn, lengthIn, pieces } = d;
  if (thicknessIn == null || widthIn == null || lengthIn == null || pieces == null) {
    throw new BadRequestException('Thickness, width, length and number of pieces are all required for a board-feet material');
  }
  if (thicknessIn <= 0 || widthIn <= 0 || lengthIn <= 0 || pieces <= 0) {
    throw new BadRequestException('Thickness, width, length and pieces must be positive numbers');
  }
  return Math.round(((thicknessIn * widthIn * lengthIn) / 144) * pieces * 100) / 100;
}
