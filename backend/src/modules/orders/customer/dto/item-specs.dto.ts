import { IsOptional, IsString, MaxLength } from 'class-validator';

// Optional quotation details for one order line (Customer or Party Order) -
// printed in the order PDF's spec boxes (see quotation-pdf.util.ts). Every
// field is free text; empty ones are simply left out of the PDF.
export class ItemSpecsDto {
  @IsString() @IsOptional() @MaxLength(60) overallSize?: string;
  @IsString() @IsOptional() @MaxLength(60) headboardHeight?: string;
  @IsString() @IsOptional() @MaxLength(60) frameHeight?: string;
  @IsString() @IsOptional() @MaxLength(80) plywood?: string;
  @IsString() @IsOptional() @MaxLength(80) innerSide?: string;
  @IsString() @IsOptional() @MaxLength(80) outerSide?: string;
  @IsString() @IsOptional() @MaxLength(80) work?: string;
  @IsString() @IsOptional() @MaxLength(80) polish?: string;
  @IsString() @IsOptional() @MaxLength(80) finishType?: string;
  @IsString() @IsOptional() @MaxLength(80) foam?: string;
  @IsString() @IsOptional() @MaxLength(80) headboard?: string;
  @IsString() @IsOptional() @MaxLength(80) assemblyMethod?: string;
  @IsString() @IsOptional() @MaxLength(80) fittings?: string;
}

const SPEC_KEYS: (keyof ItemSpecsDto)[] = ['overallSize', 'headboardHeight', 'frameHeight', 'plywood', 'innerSide', 'outerSide', 'work', 'polish', 'finishType', 'foam', 'headboard', 'assemblyMethod', 'fittings'];

// Trimmed, empty fields dropped; null when nothing is left (stored as SQL NULL).
export function cleanSpecs(specs: ItemSpecsDto | null | undefined): Record<string, string> | null {
  if (!specs) return null;
  const out: Record<string, string> = {};
  for (const k of SPEC_KEYS) {
    const v = specs[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length ? out : null;
}

export function specsKey(specs: unknown): string {
  return JSON.stringify(cleanSpecs((specs ?? null) as ItemSpecsDto | null) ?? {});
}
