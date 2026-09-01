import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePaymentDto {
  @IsDateString()
  date: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  @IsOptional()
  mode?: string;

  @IsString()
  @IsOptional()
  note?: string;
}
