import { PartialType } from '@nestjs/mapped-types';
import { CreateFinishedStockDto } from './create-finished-stock.dto';

export class UpdateFinishedStockDto extends PartialType(CreateFinishedStockDto) {}
