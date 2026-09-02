import { ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateWeeklyLabourDto {
  @IsString()
  @MinLength(1)
  carpenterId: string;

  @IsDateString()
  weekStart: string;

  @IsDateString()
  weekEnd: string;

  // Which completed, not-yet-claimed CarpenterWorkItem rows this batch pays
  // for. Each item's own `total` (set per-cot via the existing work-item
  // price editor) is summed into totalLabourAmount - kept as one place to
  // set a price (the work item) rather than duplicating it here.
  @IsArray()
  @ArrayMinSize(1)
  workItemIds: string[];

  @IsNumber()
  @Min(0)
  @IsOptional()
  previousDeduction?: number;
}
