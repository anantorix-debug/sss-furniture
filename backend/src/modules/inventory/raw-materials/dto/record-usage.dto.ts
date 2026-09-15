import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Employee "Material Usage" - deliberately NOT the same shape as
// IssueMaterialDto (issue-to-work-item): one material per submission, no
// workItemId. This is a standalone consumption record ("I used this"), not
// production material allocation - see RawMaterialsService.recordUsage.
export class RecordUsageDto {
  @IsString()
  rawMaterialId: string;

  // Required for a non-BOARD_FEET material. For a BOARD_FEET material the
  // service overrides this with the server-computed Total Board Feet from
  // the dimension fields below, same override pattern as Issue Material.
  @IsNumber()
  @Min(0.01)
  quantity: number;

  @IsNumber()
  @Min(0.001)
  @IsOptional()
  thicknessIn?: number;

  @IsNumber()
  @Min(0.001)
  @IsOptional()
  widthIn?: number;

  @IsNumber()
  @Min(0.001)
  @IsOptional()
  lengthFt?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  pieces?: number;

  @IsDateString()
  date: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
