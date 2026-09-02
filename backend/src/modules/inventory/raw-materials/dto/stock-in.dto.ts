import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class StockInDto {
  @IsString()
  rawMaterialId: string;

  @IsNumber()
  @Min(0.01)
  quantity: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unitCost?: number;

  @IsDateString()
  date: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  location?: string;
}
