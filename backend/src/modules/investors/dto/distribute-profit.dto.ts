import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class DistributeProfitDto {
  @IsString()
  @IsNotEmpty()
  investorId: string;

  @IsNumber()
  @Min(0.01)
  @IsNotEmpty()
  @Type(() => Number)
  amount: number;

  @IsNotEmpty()
  date: string | Date;

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

