import { IsDateString, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

// Manual, historical "who worked on this order" entry - see the schema
// comment on OrderWorkEntry. workerName is free text on purpose (the
// person may have no system login at all), so there is no employeeId FK
// here.
export class CreateOrderWorkEntryDto {
  @IsString()
  @MinLength(1)
  workerName: string;

  @IsString()
  @IsOptional()
  workDescription?: string;

  @IsNumber()
  @Min(0)
  workerPrice: number;

  // Extra charge/extra work price, kept separate from workerPrice so both
  // print/report as their own line rather than being silently merged into
  // one number.
  @IsNumber()
  @Min(0)
  @IsOptional()
  extraPrice?: number;

  @IsDateString()
  workDate: string;
}
