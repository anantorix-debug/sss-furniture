import { IsDateString, IsOptional } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkItemDto } from './create-work-item.dto';

export class UpdateWorkItemDto extends PartialType(CreateWorkItemDto) {
  // Admin-only manual correction of the auto-set work timeline dates (e.g. a
  // stage was actually started/finished on a different real-world day than
  // whenever someone happened to click the status button). Not part of
  // CreateWorkItemDto - a fresh work item hasn't started, so there's nothing
  // to set yet; these only make sense as a correction on an existing item.
  @IsDateString()
  @IsOptional()
  startedAt?: string;

  @IsDateString()
  @IsOptional()
  finishedAt?: string;
}
