import { IsDateString, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

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
}
