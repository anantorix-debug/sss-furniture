import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateGalleryImageDto } from './dto/update-gallery-image.dto';
import { paginate, toSkipTake } from '../../common/utils/pagination.util';
import { Role } from '../../common/enums/role.enum';

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

  async remove(id: string, userId: string, force = false, viewerRole?: Role) {
    const image = await this.findOne(id);

    // referenceImageId is onDelete: SetNull on both order-item relations, so
    // this wouldn't crash - but it WOULD silently strip a product's photo
    // off every order/PDF/WhatsApp send/employee dashboard that currently
    // shows it, with no way to tell the image was ever there. Block instead
    // and say exactly how many places are using it, same as every other
    // "real usage exists" guard in this app.
    const [orderGalleryCount, customerItemCount, partyItemCount] = await Promise.all([
      this.prisma.customerOrderGalleryImage.count({ where: { galleryImageId: id } }),
      this.prisma.customerOrderItem.count({ where: { referenceImageId: id } }),
      this.prisma.partyOrderItem.count({ where: { referenceImageId: id } }),
    ]);
    const usageCount = orderGalleryCount + customerItemCount + partyItemCount;
    if (usageCount > 0 && !(force && viewerRole === Role.SUPERADMIN)) {
      if (force) throw new ForbiddenException('Only Super Admin can force this delete through');
      throw new ConflictException(
        `This image is currently used on ${usageCount} order${usageCount === 1 ? '' : 's'}/product line${usageCount === 1 ? '' : 's'} and cannot be deleted. Remove it from those orders first if you really need to delete it.`,
      );
    }
    if (usageCount > 0) {
      // Force path (SUPERADMIN only): explicitly detach every reference
      // rather than trusting the DB cascade to exist (this project's own
      // recurring caveat) - the orders/lines themselves are untouched, they
      // just lose this photo.
      await this.prisma.$transaction([
        this.prisma.customerOrderGalleryImage.deleteMany({ where: { galleryImageId: id } }),
        this.prisma.customerOrderItem.updateMany({ where: { referenceImageId: id }, data: { referenceImageId: null } }),
        this.prisma.partyOrderItem.updateMany({ where: { referenceImageId: id }, data: { referenceImageId: null } }),
      ]);
      await this.audit.log({
        userId,
        action: 'FORCE_DELETE_GALLERY_IMAGE',
        targetType: 'GalleryImage',
        targetId: id,
        metadata: { fileName: image.fileName, usageCount },
      });
    }

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
