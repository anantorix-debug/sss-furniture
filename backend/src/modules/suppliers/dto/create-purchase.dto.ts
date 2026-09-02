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

  @IsNumber()
  @IsOptional()
  price?: number;

  @IsNumber()
  @Min(0)
  value: number;
}
