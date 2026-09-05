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

  // Optional: a Carpenter/Polisher adding their own cot entry doesn't set a
  // price - that's entered by Co-Admin at week-end labour review (see
  // WeeklyLabourService). Required in practice only when an Admin creates
  // the entry directly; the service zeroes these out for non-Admin callers
  // regardless of what's submitted here, as defense in depth.
  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number;

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
  @IsOptional()
  total?: number;

  @IsOptional()
  notifyWhatsapp?: boolean;

  // Optional link to an existing Godown Stock product this item's output
  // should feed once completed - "manufacture without any order" (source
  // stays the default STOCK either way). Omit to have completion create a
  // brand-new Product automatically from productName/size/modelNo.
  @IsString()
  @IsOptional()
  productId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
