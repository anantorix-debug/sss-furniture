import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateDispatchDto {
  @IsString()
  @MinLength(1)
  jobNumber: string;

  @IsString()
  @IsOptional()
  finishedStockId?: string;

  @IsDateString()
  dispatchDate: string;

  @IsString()
  @IsOptional()
  vehicle?: string;

  @IsString()
  @IsOptional()
  driverName?: string;

  @IsString()
  @IsOptional()
  driverContact?: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsString()
  @IsOptional()
  documentUrl?: string;
}
