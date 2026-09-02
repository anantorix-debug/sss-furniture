import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePaymentModeDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
