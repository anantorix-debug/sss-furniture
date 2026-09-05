import { IsEnum, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

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

  // Optional link to this worker's own login (Carpenter/Carver/Polisher
  // role User) - lets "My Work" find their own assignments. Omit (create)
  // or send null (edit, to clear an existing link) for a payee with no
  // app login.
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsOptional()
  userId?: string | null;
}
