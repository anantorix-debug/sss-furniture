import { PartialType } from '@nestjs/swagger';
import { CreateFinishedStockDto } from './create-finished-stock.dto';

export class UpdateFinishedStockDto extends PartialType(CreateFinishedStockDto) {}
