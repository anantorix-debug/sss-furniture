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

  // Manual override - normally the server auto-assigns the next sequential
  // number (see ExpensesService.nextVoucherNumber). Only honored for
  // Super Admin, who is the only user of this module anyway.
  @IsInt()
  @Min(1)
  @IsOptional()
  voucherNumber?: number;

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
