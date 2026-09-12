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

  @IsString()
  @IsOptional()
  sizeUnit?: string;

  // Optional - a Carpenter/Polisher's own self-entry never sets this
  // anyway (see CarpenterService.createWorkItem), and an Admin can leave
  // it blank to fill in the labour price later at week-end review.
  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number;

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

  // Required (enforced in the service) when stage is POLISH - tells the
  // polish worker what colour to use without them having to ask.
  @IsString()
  @IsOptional()
  color?: string;
}
