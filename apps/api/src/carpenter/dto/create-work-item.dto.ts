import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export enum ProductionStageDto {
  CARPENTER = 'CARPENTER',
  CARVING = 'CARVING',
  POLISH = 'POLISH',
}

export class CreateWorkItemDto {
  @IsString()
  @IsOptional()
  carpenterId?: string;

  // Which stage of the Carpenter -> Carving -> Polish pipeline this item
  // represents. Assigned manually by whoever creates it - there is no
  // automatic hand-off between stages, only a notification when one
  // finishes (see updateWorkStatus). Defaults to CARPENTER when omitted.
  @IsEnum(ProductionStageDto)
  @IsOptional()
  stage?: ProductionStageDto;

  @IsDateString()
  workDate: string;

  @IsString()
  @IsOptional()
  modelNo?: string;

  @IsString()
  @MinLength(1)
  productName: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  size?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  extra?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @IsNumber()
  @Min(0)
  total: number;

  @IsOptional()
  notifyWhatsapp?: boolean;
}
