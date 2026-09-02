import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export enum PaymentTypeDto {
  ADVANCE = 'ADVANCE',
  PARTIAL = 'PARTIAL',
  BALANCE = 'BALANCE',
  FULL = 'FULL',
}

export class CreatePaymentDto {
  @IsDateString()
  date: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  // Optional - the service auto-suggests ADVANCE/BALANCE/PARTIAL based on
  // the order's payment history when omitted (see withAutoType in
  // customer-orders.service.ts / party-orders.service.ts).
  @IsEnum(PaymentTypeDto)
  @IsOptional()
  type?: PaymentTypeDto;

  @IsString()
  @IsOptional()
  mode?: string;

  @IsString()
  @IsOptional()
  note?: string;
}
