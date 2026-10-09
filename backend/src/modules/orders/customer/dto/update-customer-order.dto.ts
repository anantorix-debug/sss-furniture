import { PartialType } from '@nestjs/swagger';
import { CreateCustomerOrderDto } from './create-customer-order.dto';

export class UpdateCustomerOrderDto extends PartialType(CreateCustomerOrderDto) {}
