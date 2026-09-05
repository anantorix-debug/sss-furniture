import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateGalleryImageDto } from './dto/update-gallery-image.dto';
import { paginate, toSkipTake } from '../../common/utils/pagination.util';

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'gallery');

// Images-only visual reference of manufactured furniture, for quickly
// picking a photo to share with a customer over WhatsApp - deliberately
// NOT a second product catalogue (see the model comment in schema.prisma).
// Reuses the exact local-disk upload pattern already proven by
// ProductsService.addImage (memory-storage multer, validated before
// anything touches disk).
@Injectable()
export class GalleryService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async findAll(params: { modelNo?: string; page?: number; limit?: number } = {}) {
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 40;
    const where = params.modelNo ? { modelNo: { contains: params.modelNo } } : {};
    const [images, total] = await Promise.all([
      this.prisma.galleryImage.findMany({
        where,
        include: { uploadedBy: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: paginated ? limit : 200,
        ...(paginated ? toSkipTake(page, limit) : {}),
      }),
      paginated ? this.prisma.galleryImage.count({ where }) : Promise.resolve(0),
    ]);
    return paginated ? paginate(images, total, page, limit) : images;
  }

  async findOne(id: string) {
    const image = await this.prisma.galleryImage.findUnique({ where: { id } });
    if (!image) throw new NotFoundException('Gallery image not found');
    return image;
  }

  async upload(file: Express.Multer.File, userId: string) {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const filename = `${randomUUID()}${extname(file.originalname).toLowerCase() || '.jpg'}`;
    await fs.writeFile(join(UPLOAD_DIR, filename), file.buffer);

    const image = await this.prisma.galleryImage.create({
      data: {
        url: `/uploads/gallery/${filename}`,
        fileName: file.originalname,
        fileSize: file.size,
        uploadedById: userId,
      },
    });

    await this.audit.log({
      userId,
      action: 'GALLERY_IMAGE_UPLOADED',
      targetType: 'GalleryImage',
      targetId: image.id,
      metadata: { fileName: file.originalname, fileSize: file.size },
    });

    return image;
  }

  async update(id: string, dto: UpdateGalleryImageDto) {
    await this.findOne(id);
    return this.prisma.galleryImage.update({ where: { id }, data: dto });
  }

  async remove(id: string, userId: string) {
    const image = await this.findOne(id);
    await this.prisma.galleryImage.delete({ where: { id } });
    await fs.unlink(join(UPLOAD_DIR, image.url.split('/').pop()!)).catch(() => undefined);

    await this.audit.log({
      userId,
      action: 'GALLERY_IMAGE_DELETED',
      targetType: 'GalleryImage',
      targetId: id,
      metadata: { fileName: image.fileName },
    });

    return { success: true };
  }
}
