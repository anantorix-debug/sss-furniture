import { PartialType } from '@nestjs/mapped-types';
import { CreateProductionTeamDto } from './create-production-team.dto';

export class UpdateProductionTeamDto extends PartialType(CreateProductionTeamDto) {}
