import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { DeliveryStatus } from '../../common/enums/delivery-status.enum';

export class CreatePartyOrderDto {
  // Model No (cotNo) is intentionally NOT settable here - only the
  // production employee assigned to this order can set it, via the
  // dedicated /model-no endpoint.

  @IsDateString()
  orderDate: string;

  @IsString()
  @MinLength(1)
  shopName: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @MinLength(1)
  model: string;

  @IsString()
  @IsOptional()
  finish?: string;

  @IsString()
  @IsOptional()
  details?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  qty?: number;

  @IsNumber()
  @Min(0)
  price: number;

  @IsNumber()
  @Min(0)
  totalAmount: number;

  @IsString()
  @IsOptional()
  cashTrack?: string;

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
