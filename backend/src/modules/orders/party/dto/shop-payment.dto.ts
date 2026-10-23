import { ArrayNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';
import { CreatePaymentDto } from '../../customer/dto/create-payment.dto';

// The per-order payment rows that make up one shop payment on the Shop
// Dashboard's Payment Ledger (see PartyOrdersService.updateShopPayment).
export class ShopPaymentIdsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  paymentIds: string[];
}

export class UpdateShopPaymentDto extends CreatePaymentDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  paymentIds: string[];
}

// Record Payment on the shop page. orderId (optional) = pay this one order;
// omitted = current orders first, then Old Balance.
export class AddShopPaymentDto extends CreatePaymentDto {
  @IsString()
  @IsOptional()
  orderId?: string;
}
