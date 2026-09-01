import { PartialType } from '@nestjs/mapped-types';
import { CreatePartyOrderDto } from './create-party-order.dto';

export class UpdatePartyOrderDto extends PartialType(CreatePartyOrderDto) {}
