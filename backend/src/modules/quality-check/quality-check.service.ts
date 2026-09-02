import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQualityCheckDto } from './dto/create-quality-check.dto';
import { UpdateQualityCheckDto } from './dto/update-quality-check.dto';
import { paginate, toSkipTake } from '../../common/utils/pagination.util';

@Injectable()
export class QualityCheckService {
  constructor(private prisma: PrismaService) {}

  // Opt-in pagination - see the identical note on CustomerOrdersService.findAll.
  async findAll(params: { jobNumber?: string; page?: number; limit?: number } = {}) {
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = params.jobNumber ? { jobNumber: params.jobNumber } : {};
    const [checks, total] = await Promise.all([
      this.prisma.qualityCheck.findMany({
        where,
        include: { workItem: true, inspectedBy: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        ...(paginated ? toSkipTake(page, limit) : {}),
      }),
      paginated ? this.prisma.qualityCheck.count({ where }) : Promise.resolve(0),
    ]);
    return paginated ? paginate(checks, total, page, limit) : checks;
  }

  async findOne(id: string) {
    const check = await this.prisma.qualityCheck.findUnique({
      where: { id },
      include: { workItem: true, inspectedBy: { select: { id: true, name: true } } },
    });
    if (!check) throw new NotFoundException('Quality check not found');
    return check;
  }

  // Recording a check also feeds back into the work item's status, matching
  // step 6 of the workflow: PASSED moves it toward finished stock, anything
  // else sends it back to REWORK for the same worker to redo.
  async create(dto: CreateQualityCheckDto, inspectedById: string) {
    const check = await this.prisma.qualityCheck.create({
      data: {
        jobNumber: dto.jobNumber,
        workItemId: dto.workItemId,
        result: dto.result,
        remarks: dto.remarks,
        photoUrl: dto.photoUrl,
        inspectedById,
      },
    });

    if (dto.workItemId) {
      await this.prisma.carpenterWorkItem.update({
        where: { id: dto.workItemId },
        data: {
          status: dto.result === 'PASSED' ? 'COMPLETED' : 'REWORK',
          qcNote: dto.remarks,
        },
      }).catch(() => null); // work item may not exist / may have been removed - QC record still stands
    }

    return this.findOne(check.id);
  }

  async update(id: string, dto: UpdateQualityCheckDto) {
    await this.findOne(id);
    await this.prisma.qualityCheck.update({
      where: { id },
      data: {
        jobNumber: dto.jobNumber,
        workItemId: dto.workItemId,
        result: dto.result,
        remarks: dto.remarks,
        photoUrl: dto.photoUrl,
      },
    });
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.qualityCheck.delete({ where: { id } });
    return { success: true };
  }
}
