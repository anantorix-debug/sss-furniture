import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum WorkStatusDto {
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  QUALITY_CHECK = 'QUALITY_CHECK',
  REWORK = 'REWORK',
  COMPLETED = 'COMPLETED',
}

export class UpdateWorkStatusDto {
  @IsEnum(WorkStatusDto)
  status: WorkStatusDto;

  @IsString()
  @IsOptional()
  qcNote?: string;
}
