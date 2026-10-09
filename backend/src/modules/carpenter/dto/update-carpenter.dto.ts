import { PartialType } from '@nestjs/swagger';
import { CreateCarpenterDto } from './create-carpenter.dto';

export class UpdateCarpenterDto extends PartialType(CreateCarpenterDto) {}
