import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class IssueMaterialItemDto {
  @IsString()
  rawMaterialId: string;

  @IsNumber()
  @Min(0.01)
  quantity: number;
}

export class IssueMaterialDto {
  @IsString()
  workItemId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => IssueMaterialItemDto)
  items: IssueMaterialItemDto[];

  @IsDateString()
  date: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
