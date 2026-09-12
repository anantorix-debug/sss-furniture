import { IsInt, IsNumber, IsDateString, IsOptional, IsString, Min, MinLength, ValidateIf } from 'class-validator';

export class CreatePurchaseDto {
  @IsDateString()
  date: string;

  @IsString()
  @MinLength(1)
  particulars: string;

  @IsNumber()
  @IsOptional()
  qty?: number;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsNumber()
  @IsOptional()
  price?: number;

  // When both qty and price are given, value is always server-computed as
  // qty * price (see SuppliersService.addPurchase/updatePurchase) so it
  // never needs to be typed. Only required for a lump-sum entry with no
  // qty/price (e.g. a flat "RENT" line) - the service enforces that.
  @IsNumber()
  @Min(0)
  @IsOptional()
  value?: number;

  // Optional link to a RawMaterial - when set, a paired StockMovement keeps
  // stock in sync (see SuppliersService.resolvePurchaseData). Send explicit
  // null on an edit to unlink a material from a purchase (same "explicit
  // null to clear" pattern as Carpenter.teamId/userId elsewhere).
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsOptional()
  rawMaterialId?: string | null;

  // Wood dimensions (inches) - required together only when the linked
  // material's measurementKind is BOARD_FEET; enforced in the service since
  // that depends on a DB-looked-up value, not expressible as a DTO rule.
  @IsNumber()
  @Min(0.001)
  @IsOptional()
  thicknessIn?: number;

  @IsNumber()
  @Min(0.001)
  @IsOptional()
  widthIn?: number;

  @IsNumber()
  @Min(0.001)
  @IsOptional()
  lengthIn?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  pieces?: number;
}
