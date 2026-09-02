import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ExpenseScopeDto } from './create-expense.dto';

export class CreateExpenseCategoryDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEnum(ExpenseScopeDto)
  @IsOptional()
  scope?: ExpenseScopeDto; // omit = usable for either scope

  @IsString()
  @IsOptional()
  defaultReferenceTypeId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
