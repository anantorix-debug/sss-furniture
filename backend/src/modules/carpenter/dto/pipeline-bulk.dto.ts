import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum PipelineTarget {
  QC_PASSED = 'QC_PASSED',
  REWORK = 'REWORK',
  FAILED = 'FAILED',
  IN_STOCK = 'IN_STOCK',
  DISPATCHED = 'DISPATCHED',
}

export class PipelineBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  workItemIds: string[];

  @IsEnum(PipelineTarget)
  target: PipelineTarget;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}
