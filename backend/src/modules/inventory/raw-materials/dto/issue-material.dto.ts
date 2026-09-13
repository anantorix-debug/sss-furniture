import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class IssueMaterialItemDto {
  @IsString()
  rawMaterialId: string;

  // Required for a non-BOARD_FEET material. For a BOARD_FEET material the
  // service overrides this with the server-computed Total Board Feet from
  // the four dimension fields below, same pattern as Purchases - the
  // client's quantity is never trusted for those lines.
  @IsNumber()
  @Min(0.01)
  quantity: number;

  // Wood dimensions - only meaningful when rawMaterialId points at a
  // BOARD_FEET material; enforced in the service since that depends on a
  // DB-looked-up value. Thickness/width are in inches, length is in feet
  // (see computeBoardFeet).
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
  lengthFt?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  pieces?: number;
}

export class IssueMaterialDto {
  @IsString()
  workItemId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => IssueMaterialItemDto)
  items: IssueMaterialItemDto[];

  @IsDateString()
  date: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
