import { PartialType } from '@nestjs/mapped-types';
import { CreateQualityCheckDto } from './create-quality-check.dto';

export class UpdateQualityCheckDto extends PartialType(CreateQualityCheckDto) {}
