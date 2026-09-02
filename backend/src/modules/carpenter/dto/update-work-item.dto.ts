import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkItemDto } from './create-work-item.dto';

export class UpdateWorkItemDto extends PartialType(CreateWorkItemDto) {}
