import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateRawMaterialDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @MinLength(1)
  unit: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  reorderLevel?: number;
}
