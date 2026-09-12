import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class PurchaseOrderItemDto {
  @IsString()
  rawMaterialId: string;

  // Ordered quantity - required for a non-BOARD_FEET material. For a
  // BOARD_FEET material the service overrides this with the server-computed
  // Total Board Feet from the four dimension fields below, ignoring
  // whatever's sent here (see PurchaseOrdersService).
  @IsNumber()
  @Min(0.01)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  // Wood dimensions (inches) - required together only when rawMaterialId
  // points at a BOARD_FEET material; enforced in the service since that
  // depends on a DB-looked-up value, not expressible as a DTO rule.
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
  lengthIn?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  pieces?: number;
}

export class CreatePurchaseOrderDto {
  @IsString()
  supplierId: string;

  @IsDateString()
  orderDate: string;

  @IsDateString()
  @IsOptional()
  expectedDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];
}
