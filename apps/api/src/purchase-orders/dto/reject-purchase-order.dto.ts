import { IsString, MinLength } from 'class-validator';

export class RejectPurchaseOrderDto {
  @IsString()
  @MinLength(1)
  rejectionReason: string;
}
