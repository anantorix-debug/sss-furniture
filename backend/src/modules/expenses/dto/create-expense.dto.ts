import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export enum ExpenseScopeDto {
  COMPANY = 'COMPANY',
  PERSONAL = 'PERSONAL',
}

export class CreateExpenseDto {
  @IsDateString()
  date: string;

  @IsString()
  @IsOptional()
  referenceTypeId?: string;

  // Optional - left blank when the slip has no number; never auto-filled.
  // 0 is accepted (and may repeat); any other number can be used only once.
  @IsInt()
  @Min(0)
  @IsOptional()
  voucherNumber?: number | null;

  @IsString()
  @MinLength(1)
  categoryId: string;

  @IsString()
  @MinLength(1)
  particulars: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  @MinLength(1)
  paymentModeId: string;

  @IsEnum(ExpenseScopeDto)
  @IsOptional()
  scope?: ExpenseScopeDto;

  @IsString()
  @IsOptional()
  paidBy?: string;

  @IsString()
  @IsOptional()
  employeeId?: string;

  @IsString()
  @IsOptional()
  vendorName?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  attachmentUrl?: string;

  @IsString()
  @IsOptional()
  tags?: string;
}
