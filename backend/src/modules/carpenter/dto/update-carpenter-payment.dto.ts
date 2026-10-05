import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { CARPENTER_PAYMENT_TYPES } from './create-carpenter-payment.dto';

export class UpdateCarpenterPaymentDto {
  @IsDateString()
  @IsOptional()
  date?: string;

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  amount?: number;

  @IsString()
  @IsOptional()
  mode?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsIn(CARPENTER_PAYMENT_TYPES)
  @IsOptional()
  paymentType?: string;

  @IsString()
  @IsOptional()
  reference?: string;
}
