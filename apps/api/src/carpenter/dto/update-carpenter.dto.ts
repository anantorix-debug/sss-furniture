import { PartialType } from '@nestjs/mapped-types';
import { CreateCarpenterDto } from './create-carpenter.dto';

export class UpdateCarpenterDto extends PartialType(CreateCarpenterDto) {}
