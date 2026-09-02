import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateSupplierPaymentDto {
  @IsDateString()
  date: string;

  @IsString()
  @IsOptional()
  particulars?: string;

  @IsString()
  @IsOptional()
  voucherNo?: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  @IsOptional()
  mode?: string;
}
