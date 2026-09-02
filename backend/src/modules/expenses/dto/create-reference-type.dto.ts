import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateReferenceTypeDto {
  @IsString()
  @MinLength(1)
  code: string;

  @IsString()
  @MinLength(1)
  label: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
