import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

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

  // Admin/Super Admin override to skip the stage-order guard (e.g. finish
  // Carving straight to COMPLETED without a Polish stage). Ignored for any
  // other role - see CarpenterService.updateWorkStatus.
  @IsBoolean()
  @IsOptional()
  force?: boolean;
}
