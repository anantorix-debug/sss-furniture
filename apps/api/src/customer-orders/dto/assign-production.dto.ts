import { IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AssignProductionDto {
  @IsString()
  carpenterId: string;

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
