import { IsBoolean, IsEnum, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
import { WorkerTypeDto } from './create-carpenter.dto';

export class CreateProductionTeamDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEnum(WorkerTypeDto)
  workerType: WorkerTypeDto;

  // Who leads this crew - an existing app login (Users & Roles), not a
  // free-typed name. Creating a new head means creating a User there first.
  // Omit to leave unchanged, send null to clear back to "Not set".
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsOptional()
  headUserId?: string | null;

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
