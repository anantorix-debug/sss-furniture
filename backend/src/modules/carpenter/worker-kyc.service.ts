import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, WorkerDocumentKind } from '@prisma/client';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateWorkerKycDto } from './dto/update-worker-kyc.dto';

// Private folder - NOT under backend/uploads (which is served publicly at
// /uploads). Files here are only ever read by downloadDocument below.
export const WORKER_DOCS_DIR = join(process.cwd(), 'private-uploads', 'worker-docs');
export const WORKER_DOC_MAX_BYTES = 5 * 1024 * 1024;
const MAX_DOCS_PER_WORKER = 30;

// Accepted file types, recognised from the file's own first bytes (not the
// name or the browser-reported type, which are easy to fake).
const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'application/pdf', ext: '.pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/jpeg', ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: '.png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: '.webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

const KYC_FIELDS = ['aadhaarNumber', 'panNumber', 'bankAccountHolder', 'bankAccountNumber', 'bankIfsc', 'bankName', 'bankBranch'] as const;

@Injectable()
export class WorkerKycService {
  private readonly logger = new Logger(WorkerKycService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private async assertWorker(carpenterId: string) {
    const worker = await this.prisma.carpenter.findUnique({ where: { id: carpenterId }, select: { id: true, name: true } });
    if (!worker) throw new NotFoundException('Worker not found');
    return worker;
  }

  // Details + document list for the worker page / edit form.
  async get(carpenterId: string) {
    await this.assertWorker(carpenterId);
    const [kyc, documents] = await Promise.all([
      this.prisma.workerKyc.findUnique({ where: { carpenterId } }),
      this.prisma.workerDocument.findMany({
        where: { carpenterId },
        orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true },
      }),
    ]);
    const details = Object.fromEntries(KYC_FIELDS.map((f) => [f, kyc?.[f] ?? null])) as Record<(typeof KYC_FIELDS)[number], string | null>;
    return { carpenterId, ...details, updatedAt: kyc?.updatedAt ?? null, documents };
  }

  async update(carpenterId: string, dto: UpdateWorkerKycDto, userId: string) {
    const worker = await this.assertWorker(carpenterId);
    const before = await this.prisma.workerKyc.findUnique({ where: { carpenterId } });

    // The same Aadhaar / PAN can't belong to two workers - a typo or a
    // duplicate worker record. Checked up front for a clear message; the
    // unique index also blocks it if two saves race.
    if (dto.aadhaarNumber) await this.assertNotUsedElsewhere('aadhaarNumber', dto.aadhaarNumber, carpenterId, 'Aadhaar number');
    if (dto.panNumber) await this.assertNotUsedElsewhere('panNumber', dto.panNumber, carpenterId, 'PAN');

    const data: Record<string, string | null> = {};
    for (const f of KYC_FIELDS) if (dto[f] !== undefined) data[f] = dto[f] ?? null;
    try {
      await this.prisma.workerKyc.upsert({
        where: { carpenterId },
        create: { carpenterId, ...data, updatedById: userId },
        update: { ...data, updatedById: userId },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This Aadhaar or PAN is already saved for another worker');
      }
      throw e;
    }

    // Which fields changed - never the values themselves.
    const changed = KYC_FIELDS.filter((f) => data[f] !== undefined && (before?.[f] ?? null) !== data[f]);
    if (changed.length) {
      await this.audit.log({ userId, action: 'WORKER_KYC_UPDATED', targetType: 'Carpenter', targetId: carpenterId, metadata: { worker: worker.name, fields: changed } });
    }
    return this.get(carpenterId);
  }

  private async assertNotUsedElsewhere(field: 'aadhaarNumber' | 'panNumber', value: string, carpenterId: string, label: string) {
    const other = await this.prisma.workerKyc.findFirst({
      where: { [field]: value, carpenterId: { not: carpenterId } },
      select: { carpenter: { select: { name: true } } },
    });
    if (other) throw new ConflictException(`This ${label} is already saved for worker "${other.carpenter.name}"`);
  }

  async addDocument(carpenterId: string, kind: string, file: Express.Multer.File | undefined, userId: string) {
    const worker = await this.assertWorker(carpenterId);
    if (!Object.values(WorkerDocumentKind).includes(kind as WorkerDocumentKind)) {
      throw new BadRequestException('Document type must be AADHAAR, PAN or BANK');
    }
    if (!file || !file.buffer?.length) throw new BadRequestException('Choose a file to upload');
    if (file.size > WORKER_DOC_MAX_BYTES) throw new BadRequestException('File must be 5 MB or less');
    const type = SIGNATURES.find((s) => s.test(file.buffer));
    if (!type) throw new BadRequestException('Only PDF, JPG, PNG or WEBP files can be uploaded');
    const count = await this.prisma.workerDocument.count({ where: { carpenterId } });
    if (count >= MAX_DOCS_PER_WORKER) throw new BadRequestException(`A worker can have at most ${MAX_DOCS_PER_WORKER} documents - remove an old one first`);

    await fs.mkdir(WORKER_DOCS_DIR, { recursive: true });
    const storedName = `${randomUUID()}${type.ext}`;
    await fs.writeFile(join(WORKER_DOCS_DIR, storedName), file.buffer, { mode: 0o600 });
    const fileName = (file.originalname || `document${type.ext}`).replace(/[^\w.\- ()]/g, '_').slice(0, 150);
    try {
      const doc = await this.prisma.workerDocument.create({
        data: { carpenterId, kind: kind as WorkerDocumentKind, fileName, storedName, mimeType: type.mime, size: file.size, uploadedById: userId },
        select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true },
      });
      await this.audit.log({ userId, action: 'WORKER_DOCUMENT_ADDED', targetType: 'Carpenter', targetId: carpenterId, metadata: { worker: worker.name, kind, fileName, size: file.size } });
      return doc;
    } catch (e) {
      await fs.unlink(join(WORKER_DOCS_DIR, storedName)).catch(() => undefined);
      throw e;
    }
  }

  // The file itself, for the Admin-only download/view endpoint.
  async readDocument(carpenterId: string, documentId: string, userId: string) {
    const doc = await this.prisma.workerDocument.findUnique({ where: { id: documentId } });
    if (!doc || doc.carpenterId !== carpenterId) throw new NotFoundException('Document not found');
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(join(WORKER_DOCS_DIR, doc.storedName));
    } catch {
      throw new NotFoundException('The file for this document is missing on the server');
    }
    await this.audit.log({ userId, action: 'WORKER_DOCUMENT_VIEWED', targetType: 'Carpenter', targetId: carpenterId, metadata: { kind: doc.kind, fileName: doc.fileName } });
    return { buffer, mimeType: doc.mimeType, fileName: doc.fileName };
  }

  async removeDocument(carpenterId: string, documentId: string, userId: string) {
    const doc = await this.prisma.workerDocument.findUnique({ where: { id: documentId } });
    if (!doc || doc.carpenterId !== carpenterId) throw new NotFoundException('Document not found');
    await this.prisma.workerDocument.delete({ where: { id: documentId } });
    await fs.unlink(join(WORKER_DOCS_DIR, doc.storedName)).catch((e) => this.logger.warn(`Could not delete ${doc.storedName}: ${e}`));
    await this.audit.log({ userId, action: 'WORKER_DOCUMENT_REMOVED', targetType: 'Carpenter', targetId: carpenterId, metadata: { kind: doc.kind, fileName: doc.fileName } });
    return { success: true };
  }

  // Called when a worker is deleted - the database rows and the files on
  // disk both go (FK cascades aren't relied on, see removeCarpenter).
  async purge(carpenterId: string) {
    const docs = await this.prisma.workerDocument.findMany({ where: { carpenterId }, select: { storedName: true } });
    await this.prisma.$transaction([
      this.prisma.workerDocument.deleteMany({ where: { carpenterId } }),
      this.prisma.workerKyc.deleteMany({ where: { carpenterId } }),
    ]);
    for (const d of docs) await fs.unlink(join(WORKER_DOCS_DIR, d.storedName)).catch(() => undefined);
  }
}
