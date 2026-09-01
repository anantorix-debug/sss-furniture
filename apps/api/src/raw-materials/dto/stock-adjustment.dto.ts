import { IsDateString, IsNumber, IsString, MinLength } from 'class-validator';

export class StockAdjustmentDto {
  @IsString()
  rawMaterialId: string;

  // Signed delta: negative for damage/wastage, positive for a found surplus.
  @IsNumber()
  quantity: number;

  @IsString()
  @MinLength(1)
  reason: string;

  @IsDateString()
  date: string;
}
