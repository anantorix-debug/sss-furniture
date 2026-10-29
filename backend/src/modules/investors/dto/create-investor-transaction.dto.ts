import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum InvestorTransactionTypeDto {
  INVESTMENT = 'INVESTMENT',
  PAYOUT = 'PAYOUT',
}

export class CreateInvestorTransactionDto {
  @IsEnum(InvestorTransactionTypeDto)
  @IsNotEmpty()
  type: InvestorTransactionTypeDto;

  @IsNotEmpty()
  date: string | Date;

  @IsNumber()
  @Min(0.01)
  @IsNotEmpty()
  @Type(() => Number)
  amount: number;

  @IsString()
  @IsOptional()
  paymentMode?: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsOptional()
  periodFrom?: string | Date;

  @IsOptional()
  periodTo?: string | Date;
}

