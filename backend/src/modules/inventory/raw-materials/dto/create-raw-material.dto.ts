import { IsEnum, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export enum MaterialGroupDto {
  WOOD = 'WOOD',
  CARVING = 'CARVING',
  POLISH = 'POLISH',
  OTHER = 'OTHER',
}

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

  // Which team this material belongs to (Carpenter/Carving/Polish) - drives
  // both the employee-facing filtered material picker and the Stock In
  // team-ownership check. Defaults to WOOD (Carpenter) when omitted.
  @IsEnum(MaterialGroupDto)
  @IsOptional()
  materialGroup?: MaterialGroupDto;
}
