import { IsOptional, IsString } from 'class-validator';

export class UpdateGalleryImageDto {
  @IsString()
  @IsOptional()
  modelNo?: string;

  @IsString()
  @IsOptional()
  caption?: string;
}
