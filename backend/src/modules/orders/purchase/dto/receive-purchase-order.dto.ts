import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsString, Min, ValidateNested } from 'class-validator';

class ReceiveItemDto {
  @IsString()
  purchaseOrderItemId: string;

  @IsNumber()
  @Min(0.01)
  receivedQuantity: number;
}

// A receiving event names exactly which lines and how much of each - lets a
// subset of a PO's lines be received while others wait, so a PO can be
// received across multiple partial deliveries.
export class ReceivePurchaseOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveItemDto)
  items: ReceiveItemDto[];
}
