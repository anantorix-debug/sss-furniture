import { IsEnum, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export enum MaterialGroupDto {
  WOOD = 'WOOD',
  CARVING = 'CARVING',
  POLISH = 'POLISH',
  OTHER = 'OTHER',
}

export enum MaterialMeasurementKindDto {
  BOARD_FEET = 'BOARD_FEET',
  SHEET = 'SHEET',
  LIQUID = 'LIQUID',
  COUNT = 'COUNT',
  OTHER = 'OTHER',
}

export class CreateRawMaterialDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @IsOptional()
  type?: string;

  // Optional at the DTO level - locked/derived server-side for every
  // measurementKind except OTHER (see RawMaterialsService.resolveUnit).
  @IsString()
  @IsOptional()
  unit?: string;

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

  // Which physical quantity this material is bought/sold in - drives the
  // locked unit and which purchase-math fields the Suppliers "Add
  // Purchase" form shows. Defaults to OTHER (today's free-text unit).
  @IsEnum(MaterialMeasurementKindDto)
  @IsOptional()
  measurementKind?: MaterialMeasurementKindDto;
}
