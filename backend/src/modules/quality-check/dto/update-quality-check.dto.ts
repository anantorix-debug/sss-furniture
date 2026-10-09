import { PartialType } from '@nestjs/swagger';
import { CreateQualityCheckDto } from './create-quality-check.dto';

export class UpdateQualityCheckDto extends PartialType(CreateQualityCheckDto) {}
