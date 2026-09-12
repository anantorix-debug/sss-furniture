import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { WorkerTypeDto } from './create-carpenter.dto';

export class CreateProductionTeamDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEnum(WorkerTypeDto)
  workerType: WorkerTypeDto;

  // Who leads this crew - a plain display name, not a linked worker/login.
  @IsString()
  @IsOptional()
  headName?: string;

  // WhatsApp group this team's work-assignment notifications go to -
  // optional, falls back to the type-wide WhatsappGroupSetting if unset.
  @IsString()
  @IsOptional()
  groupId?: string;

  @IsString()
  @IsOptional()
  groupName?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
