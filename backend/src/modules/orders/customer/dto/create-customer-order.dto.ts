import { ArrayMinSize, IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryStatus } from '../../../../common/enums/delivery-status.enum';

export class CustomerOrderItemDto {
  // Set when this line is an existing Godown Stock product - triggers the
  // stock-first check/split. Omitted for a brand-new custom product (full
  // quantity goes to production, Model No stays "Not Updated" until
  // Production Employee assigns it).
  @IsString()
  @IsOptional()
  productId?: string;

  @IsString()
  @MinLength(1)
  productName: string;

  // Auto-filled from the selected Model No's saved product data when one
  // exists; left for manual entry (or blank) for a brand-new/custom
  // product with no existing stock record.
  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  size?: string;

  @IsString()
  @IsOptional()
  sizeUnit?: string;

  // Pre-set here so the sequential production pipeline can auto-carry it
  // to the Polish stage - the polisher already knows it without an Admin
  // having to notice and fill it in later. See CarpenterService's handoff.
  @IsString()
  @IsOptional()
  color?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  // Optional "this line looks like this" photo picked from the existing
  // Gallery - purely a visual reference, independent of the order-wide
  // gallery images used for the customer-facing WhatsApp confirmation.
  @IsString()
  @IsOptional()
  referenceImageId?: string;
}

export class CreateCustomerOrderDto {
  @IsString()
  @MinLength(1)
  orderId: string;

  @IsDateString()
  orderDate: string;

  @IsString()
  @MinLength(1)
  customerName: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  address?: string;

  // Required unless `items` is given, in which case it's derived from the
  // line items (joined product names) instead of being entered by hand.
  @IsString()
  @IsOptional()
  product?: string;

  @IsString()
  @IsOptional()
  size?: string;

  @IsString()
  @IsOptional()
  sizeUnit?: string;

  // Required unless `items` is given, in which case it's derived from the
  // sum of the line items instead of being entered by hand.
  @IsNumber()
  @Min(0)
  @IsOptional()
  orderValue?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CustomerOrderItemDto)
  @IsOptional()
  items?: CustomerOrderItemDto[];

  // Existing Gallery image ids selected for this order (spec: reference
  // only - never re-uploaded). Omitted/empty means no images attached.
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  galleryImageIds?: string[];

  // Model No (cotTrack) is intentionally NOT settable here - only the
  // production employee assigned to this order can set it, via the
  // dedicated /model-no endpoint.

  @IsDateString()
  @IsOptional()
  actualDeliveryDate?: string;

  @IsEnum(DeliveryStatus)
  @IsOptional()
  deliveryStatus?: DeliveryStatus;
}
