import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum QcResultDto {
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  REWORK_REQUIRED = 'REWORK_REQUIRED',
}

export class CreateQualityCheckDto {
  @IsString()
  @MinLength(1)
  jobNumber: string;

  @IsString()
  @IsOptional()
  workItemId?: string;

  @IsEnum(QcResultDto)
  result: QcResultDto;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsString()
  @IsOptional()
  photoUrl?: string;
}
