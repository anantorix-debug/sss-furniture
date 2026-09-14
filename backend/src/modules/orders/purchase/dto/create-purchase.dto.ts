import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class PurchaseItemDto {
  @IsString()
  rawMaterialId: string;

  // Purchased quantity - required for a non-BOARD_FEET material. For a
  // BOARD_FEET material the service overrides this with the server-computed
  // Total Board Feet from the four dimension fields below, ignoring
  // whatever's sent here (see PurchasesService).
  @IsNumber()
  @Min(0.01)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  // Wood dimensions - required together only when rawMaterialId points at a
  // BOARD_FEET material; enforced in the service since that depends on a
  // DB-looked-up value, not expressible as a DTO rule. Thickness/width are
  // in inches, length is in feet (see computeBoardFeet).
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

export class CreatePurchaseDto {
  @IsString()
  supplierId: string;

  @IsDateString()
  purchaseDate: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items: PurchaseItemDto[];
}
