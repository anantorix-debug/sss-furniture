import { PartialType } from '@nestjs/mapped-types';
import { CreateInvestorTransactionDto } from './create-investor-transaction.dto';

export class UpdateInvestorTransactionDto extends PartialType(CreateInvestorTransactionDto) {}

