import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';
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
