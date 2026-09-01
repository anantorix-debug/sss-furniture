import { IsString, MinLength } from 'class-validator';

export class UpdateModelNoDto {
  @IsString()
  @MinLength(1)
  modelNo: string;
}
