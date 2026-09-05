import { IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export enum AssignProductionStageDto {
  CARPENTER = 'CARPENTER',
  CARVING = 'CARVING',
  POLISH = 'POLISH',
}

export class AssignProductionDto {
  @IsString()
  carpenterId: string;

  // Which stage this order enters production at - defaults to CARPENTER.
  // Starting anywhere else is restricted server-side to Admin+ (same guard
  // as a bare work item, see CarpenterService.createWorkItem).
  @IsEnum(AssignProductionStageDto)
  @IsOptional()
  stage?: AssignProductionStageDto;

  @IsString()
  @IsOptional()
  notes?: string;

  // Optional: also sets this order's assignedEmployeeId (the login user
  // solely responsible for entering the Model No), unifying what used to
  // be two separate calls (assignProduction + assignEmployee) into one.
  @IsString()
  @IsOptional()
  employeeUserId?: string;

  @IsDateString()
  workDate: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  size?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  extra?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @IsBoolean()
  @IsOptional()
  notifyWhatsapp?: boolean;
}
