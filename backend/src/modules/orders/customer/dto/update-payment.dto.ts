import { PartialType } from '@nestjs/swagger';
import { CreatePaymentDto } from './create-payment.dto';

// Correcting a recorded Customer/Party Order payment - any field may change.
export class UpdatePaymentDto extends PartialType(CreatePaymentDto) {}
