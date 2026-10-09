import { PartialType } from '@nestjs/swagger';
import { CreatePartyOrderDto } from './create-party-order.dto';

export class UpdatePartyOrderDto extends PartialType(CreatePartyOrderDto) {}
