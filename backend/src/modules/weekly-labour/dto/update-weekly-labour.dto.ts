import { PartialType } from '@nestjs/mapped-types';
import { CreateWeeklyLabourDto } from './create-weekly-labour.dto';

export class UpdateWeeklyLabourDto extends PartialType(CreateWeeklyLabourDto) {}
