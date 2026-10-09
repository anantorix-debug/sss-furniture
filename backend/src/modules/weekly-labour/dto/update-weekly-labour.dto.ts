import { PartialType } from '@nestjs/swagger';
import { CreateWeeklyLabourDto } from './create-weekly-labour.dto';

export class UpdateWeeklyLabourDto extends PartialType(CreateWeeklyLabourDto) {}
