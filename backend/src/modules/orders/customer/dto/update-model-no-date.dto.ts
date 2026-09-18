import { IsDateString } from 'class-validator';

export class UpdateModelNoDateDto {
  @IsDateString()
  modelNoUpdatedAt: string;
}
