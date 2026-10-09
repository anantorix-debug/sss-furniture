import { PartialType } from '@nestjs/swagger';
import { CreateProductionTeamDto } from './create-production-team.dto';

export class UpdateProductionTeamDto extends PartialType(CreateProductionTeamDto) {}
