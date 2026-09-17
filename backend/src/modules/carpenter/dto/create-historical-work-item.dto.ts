import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { ProductionStageDto } from './create-work-item.dto';

// One employee/stage row of a historical record - e.g. "Carpenter: Employee
// A". Deliberately no price/extra/total: old paper records track WHAT was
// done and by WHOM, not live wage figures (see the Historical Entry spec -
// Quantity + Remarks only).
export class HistoricalEntryLineDto {
  @IsString()
  @MinLength(1)
  carpenterId: string;

  @IsEnum(ProductionStageDto)
  stage: ProductionStageDto;

  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

// One "old paper record" - Date/Model No/Product/Pattern/Size plus however
// many employee/stage lines it covers, saved together as one historical
// production run (see CarpenterService.createHistoricalEntry). Deliberately
// NOT the same shape as CreateWorkItemDto - this never goes through
// Assign -> Start -> End, so there's no carpenterId/stage/price at the top
// level, only inside `entries`.
export class CreateHistoricalWorkItemDto {
  @IsDateString()
  workDate: string;

  @IsString()
  @IsOptional()
  modelNo?: string;

  @IsString()
  @MinLength(1)
  productName: string;

  @IsString()
  @IsOptional()
  pattern?: string;

  @IsString()
  @IsOptional()
  size?: string;

  @IsString()
  @IsOptional()
  sizeUnit?: string;

  @IsIn(['CUSTOMER_ORDER', 'PARTY_ORDER', 'STOCK', 'OTHER'])
  source: 'CUSTOMER_ORDER' | 'PARTY_ORDER' | 'STOCK' | 'OTHER';

  // Optional even when source is CUSTOMER_ORDER/PARTY_ORDER - the old paper
  // record may simply not have that information. Never required.
  @IsString()
  @IsOptional()
  sourceCustomerOrderId?: string;

  @IsString()
  @IsOptional()
  sourceCustomerOrderItemId?: string;

  @IsString()
  @IsOptional()
  sourcePartyOrderItemId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => HistoricalEntryLineDto)
  entries: HistoricalEntryLineDto[];
}
