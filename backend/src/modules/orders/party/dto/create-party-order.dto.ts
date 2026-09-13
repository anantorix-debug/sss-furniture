import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { DeliveryStatus } from '../../../../common/enums/delivery-status.enum';

// One line of a Party Order - no fixed limit on how many of these an order
// can carry (spec explicitly rejects a 5/10-line cap).
export class PartyOrderItemDto {
  // Set when this line is an existing Godown Stock product - triggers the
  // stock-first check/split, same as CustomerOrderItemDto.productId. Omit
  // for a brand-new custom product (full qty to production).
  @IsString()
  @IsOptional()
  productId?: string;

  @IsString()
  @MinLength(1)
  productName: string;

  @IsString()
  @IsOptional()
  finish?: string;

  @IsString()
  @IsOptional()
  size?: string;

  @IsString()
  @IsOptional()
  sizeUnit?: string;

  // Pre-set here so the sequential production pipeline can auto-carry it
  // to the Polish stage - see the identical note on CustomerOrderItemDto.
  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  pattern?: string;

  @IsString()
  @IsOptional()
  details?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  qty?: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  // Round-tripped on edit so replacing this line's row (see
  // PartyOrdersService.update) doesn't wipe out a Model No the Production
  // Employee already entered. Ignored on create.
  @IsString()
  @IsOptional()
  modelNo?: string;

  // Optional "this line looks like this" photo picked from the existing
  // Gallery - same purpose as CustomerOrderItemDto.referenceImageId.
  @IsString()
  @IsOptional()
  referenceImageId?: string;
}

export class CreatePartyOrderDto {
  // Model No is per-line (PartyOrderItem.modelNo) - not settable here.

  @IsDateString()
  orderDate: string;

  // Sourced from the Shop directory (see ShopsModule) rather than typed by
  // hand - shopName is copied from the resolved Shop for display without a
  // join, matching the identical customerName-style snapshot pattern used
  // elsewhere in this schema.
  @IsString()
  @MinLength(1)
  shopId: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PartyOrderItemDto)
  items: PartyOrderItemDto[];

  // cashTrack removed - retired from create/update entirely (column stays
  // on old rows only).

  @IsString()
  @IsOptional()
  courierTrack?: string;

  @IsDateString()
  @IsOptional()
  actualDeliveryDate?: string;

  @IsEnum(DeliveryStatus)
  @IsOptional()
  deliveryStatus?: DeliveryStatus;
}
