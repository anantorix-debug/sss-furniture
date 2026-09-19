import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class UpdatePieceModelNoDto {
  // 0-based position of the piece within its multi-unit batch.
  @IsInt()
  @Min(0)
  index: number;

  @IsString()
  @MinLength(1)
  modelNo: string;
}
