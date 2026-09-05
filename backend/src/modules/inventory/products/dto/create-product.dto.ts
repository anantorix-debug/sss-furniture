import { IsBoolean, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsOptional()
  sku?: string;

  // Shared numbering with CustomerOrder.cotTrack / PartyOrder.cotNo - the
  // single reference number retail and wholesale orders both key off. Left
  // unset until a Production Employee assigns it after manufacturing.
  @IsString()
  @IsOptional()
  modelNo?: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  modelSize?: string;

  @IsString()
  @IsOptional()
  materialFinish?: string;

  @IsString()
  @IsOptional()
  sizeUnit?: string;

  @IsString()
  @IsOptional()
  pattern?: string;

  @IsString()
  @IsOptional()
  details?: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsNumber()
  @Min(0)
  retailPrice: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  wholesalePrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  costPrice?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
