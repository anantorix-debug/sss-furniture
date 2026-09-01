import { PartialType } from '@nestjs/mapped-types';
import { CreateCustomerOrderDto } from './create-customer-order.dto';

export class UpdateCustomerOrderDto extends PartialType(CreateCustomerOrderDto) {}
