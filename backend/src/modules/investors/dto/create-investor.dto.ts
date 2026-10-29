import { IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateInvestorDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  panNumber?: string;

  @IsString()
  @IsOptional()
  bankDetails?: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  sharePercentage?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  expectedRoi?: number;

  @IsString()
  @IsOptional()
  status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  joinedDate?: string | Date;

  @IsString()
  @IsOptional()
  notes?: string;

  // Optional: create initial capital investment at the same time
  @IsNumber()
  @Min(0.01)
  @IsOptional()
  @Type(() => Number)
  initialInvestment?: number;

  @IsString()
  @IsOptional()
  initialPaymentMode?: string;

  @IsString()
  @IsOptional()
  initialReference?: string;
}

