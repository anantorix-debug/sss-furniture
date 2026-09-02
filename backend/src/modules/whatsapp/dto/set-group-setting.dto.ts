import { IsOptional, IsString, MinLength } from 'class-validator';

export class SetGroupSettingDto {
  @IsString()
  @MinLength(1)
  groupId: string;

  @IsString()
  @IsOptional()
  groupName?: string;
}
