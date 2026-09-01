import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum WorkerTypeDto {
  CARPENTER = 'CARPENTER',
  POLISHER = 'POLISHER',
  CARVER = 'CARVER',
}

export class CreateCarpenterDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(WorkerTypeDto)
  @IsOptional()
  workerType?: WorkerTypeDto;
}
