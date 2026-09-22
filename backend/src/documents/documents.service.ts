import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDocumentDto, DOCUMENT_TYPES } from './dto/create-document.dto';
import { FILE_STORAGE, FileStorage } from './storage/file-storage.interface';
import { pageArgs, PageQueryDto } from '../common/pagination';

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    @Inject(FILE_STORAGE) private storage: FileStorage,
  ) {}

  async findAllForCompany(companyId: string, page: PageQueryDto = {}) {
    const where = { companyId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(page) }),
      this.prisma.document.count({ where }),
    ]);
    return { items, total };
  }

  async findAllForProject(companyId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
    });
    if (!project) {
      throw new NotFoundException('Projekt nicht gefunden.');
    }
    return this.prisma.document.findMany({ where: { projectId, companyId }, orderBy: { createdAt: 'desc' } });
  }

  async findOne(companyId: string, id: string) {
    const document = await this.prisma.document.findFirst({ where: { id, companyId } });
    if (!document) {
      throw new NotFoundException('Dokument nicht gefunden.');
    }
    return document;
  }

  async create(companyId: string, userId: string, dto: CreateDocumentDto) {
    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, companyId },
      });
      if (!project) {
        throw new NotFoundException('Projekt nicht gefunden.');
      }
    }

    return this.prisma.document.create({
      data: {
        companyId,
        projectId: dto.projectId,
        fileName: dto.fileName,
        storagePath: dto.storagePath,
        documentType: dto.documentType ?? 'other',
        uploadedByUserId: userId,
      },
    });
  }

  // Echter Datei-Upload: speichert den Dateiinhalt im Objektspeicher UND
  // registriert die Metadaten in einem Schritt – Punkt 6/15 zusammengeführt,
  // damit kein Client zwei separate Aufrufe koordinieren muss.
  async upload(
    companyId: string,
    userId: string,
    file: { originalname: string; buffer: Buffer },
    projectId?: string,
    documentType?: (typeof DOCUMENT_TYPES)[number],
  ) {
    if (projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: projectId, companyId },
      });
      if (!project) {
        throw new NotFoundException('Projekt nicht gefunden.');
      }
    }

    const stored = await this.storage.save(companyId, file.originalname, file.buffer);

    return this.prisma.document.create({
      data: {
        companyId,
        projectId,
        fileName: file.originalname,
        storagePath: stored.storagePath,
        documentType: documentType ?? 'other',
        uploadedByUserId: userId,
      },
    });
  }

  async getFileContent(companyId: string, id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const document = await this.findOne(companyId, id);
    const buffer = await this.storage.read(companyId, document.storagePath);
    return { buffer, fileName: document.fileName };
  }
}
