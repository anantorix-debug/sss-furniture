import { IsOptional, IsString } from 'class-validator';

export class RejectWeeklyLabourDto {
  @IsString()
  @IsOptional()
  reviewNote?: string;
}
