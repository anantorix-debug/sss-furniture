import { ArrayMinSize, IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryStatus } from '../../../../common/enums/delivery-status.enum';

export class CustomerOrderItemDto {
  @IsString()
  @MinLength(1)
  productName: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;
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
