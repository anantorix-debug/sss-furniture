import { ArrayMaxSize, IsArray, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CheckImportDto {
  // Grid rows: plain { column: value } objects. Not checked per element
  // here - the global ValidationPipe's implicit conversion mangles untyped
  // nested objects before @IsObject sees them - ImportsService.sanitize
  // keeps only string/number fields, and every kind re-validates each row
  // against the page's own DTO before saving.
  @IsArray()
  @ArrayMaxSize(1000)
  items: Record<string, string>[];
}

export class CommitImportDto extends CheckImportDto {
  // Row indexes the user explicitly chose to save even though they look
  // already recorded ("Save anyway").
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  confirmDuplicates?: number[];

  // Per-kind switches, e.g. { directRecord: true } for purchases.
  @IsOptional()
  @IsObject()
  options?: Record<string, boolean>;

  // Shown in the audit log only.
  @IsOptional()
  @IsString()
  sourceFileName?: string;
}
