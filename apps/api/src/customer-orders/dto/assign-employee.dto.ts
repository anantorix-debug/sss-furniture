import { IsString, MinLength } from 'class-validator';

export class AssignEmployeeDto {
  @IsString()
  @MinLength(1)
  employeeId: string;
}
