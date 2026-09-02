import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export enum FinishedStockStatusDto {
  AVAILABLE = 'AVAILABLE',
  RESERVED = 'RESERVED',
  DISPATCHED = 'DISPATCHED',
}

export class CreateFinishedStockDto {
  @IsString()
  @MinLength(1)
  jobNumber: string;

  @IsString()
  @MinLength(1)
  productName: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @IsDateString()
  completionDate: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsEnum(FinishedStockStatusDto)
  @IsOptional()
  status?: FinishedStockStatusDto;
}
