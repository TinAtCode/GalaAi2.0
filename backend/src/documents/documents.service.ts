import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { writeAudit } from '../common/audit';
import { OcrJobsService, searchableText } from '../ocr/ocr-jobs.service';
import { posix } from 'path';
import { CreateDocumentDto, DOCUMENT_TYPES } from './dto/create-document.dto';
import { FILE_STORAGE, FileStorage } from './storage/file-storage.interface';
import { pageArgs, PageQueryDto } from '../common/pagination';

// Für Listen: statt des ganzen erkannten Texts nur ein Ausschnitt
const SNIPPET_LENGTH = 160;
function snippet(text: string | null, q?: string) {
  if (!text) return null;
  const flat = searchableText(text);
  const at = q ? flat.toLowerCase().indexOf(q.toLowerCase()) : -1;
  const start = at > 40 ? at - 40 : 0;
  const part = flat.slice(start, start + SNIPPET_LENGTH);
  return `${start > 0 ? '…' : ''}${part}${start + SNIPPET_LENGTH < flat.length ? '…' : ''}`;
}

type DocumentRow = Prisma.DocumentGetPayload<object>;

// Einheitliche Schreibweise eines Speicherpfads (Trenner, ./, doppelte /)
const normalizeStoragePath = (path: string) => posix.normalize(path.replace(/\\/g, '/')).replace(/^\.\//, '');

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(FILE_STORAGE) private storage: FileStorage,
    private ocrJobs: OcrJobsService,
  ) {}

  // Listenansicht: erkannter Text nur als Ausschnitt
  private listView({ ocrText, ...document }: DocumentRow, q?: string) {
    return { ...document, ocrSnippet: snippet(ocrText, q) };
  }

  async findAllForCompany(companyId: string, page: PageQueryDto = {}) {
    const where = { companyId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(page) }),
      this.prisma.document.count({ where }),
    ]);
    return { items: items.map((d) => this.listView(d)), total };
  }

  // q: Suche in Dateiname und erkanntem Text (ohne Groß-/Kleinschreibung)
  async findAllForProject(companyId: string, projectId: string, q?: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
    });
    if (!project) {
      throw new NotFoundException('Projekt nicht gefunden.');
    }
    const search = q ? searchableText(q).slice(0, 100) : '';
    const documents = await this.prisma.document.findMany({
      where: {
        projectId,
        companyId,
        ...(search
          ? {
              OR: [
                { fileName: { contains: search, mode: 'insensitive' } },
                { ocrText: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return documents.map((d) => this.listView(d, search));
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
        storagePath: normalizeStoragePath(dto.storagePath),
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
    file: { originalname: string; buffer: Buffer; mimetype: string },
    projectId?: string,
    documentType?: (typeof DOCUMENT_TYPES)[number],
    ocr = false,
  ) {
    // Dateityp für die Texterkennung vor dem Speichern prüfen
    if (ocr) this.ocrJobs.assertSupported(file);
    if (projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: projectId, companyId },
      });
      if (!project) {
        throw new NotFoundException('Projekt nicht gefunden.');
      }
    }

    const stored = await this.storage.save(companyId, file.originalname, file.buffer);

    const document = await this.prisma.document.create({
      data: {
        companyId,
        projectId,
        fileName: file.originalname,
        storagePath: stored.storagePath,
        documentType: documentType ?? 'other',
        uploadedByUserId: userId,
        ...(ocr ? { ocrStatus: 'queued' as const } : {}),
      },
    });
    // Texterkennung im Hintergrund; das Ergebnis landet am Dokument. Lässt
    // sich der Auftrag nicht anlegen, bleibt das Dokument gespeichert und
    // gilt als "Texterkennung fehlgeschlagen" statt ewig "in Arbeit".
    if (ocr) {
      try {
        await this.ocrJobs.create(companyId, userId, file, document.id);
      } catch (error) {
        this.logger.error({
          msg: 'OCR-Auftrag konnte nicht angelegt werden',
          documentId: document.id,
          error: String(error),
        });
        return this.prisma.document.update({ where: { id: document.id }, data: { ocrStatus: 'failed' } });
      }
    }
    return document;
  }

  // Löschen mit Audit-Log. Die Datei selbst wird nur entfernt, wenn kein
  // anderes Dokument auf sie verweist (storagePath lässt sich über
  // POST /documents frei eintragen).
  async remove(companyId: string, userId: string, id: string) {
    const document = await this.findOne(companyId, id);
    // Belegbild bzw. E-Rechnung einer Eingangsrechnung ist Buchungsbeleg und
    // muss aufbewahrt werden (GoBD, 10 Jahre) – auch nach Storno
    const payable = await this.prisma.incomingInvoice.findFirst({
      where: { companyId, documentId: document.id },
      select: { id: true },
    });
    if (payable) {
      throw new ConflictException(
        'Das Dokument ist Beleg einer Eingangsrechnung und muss aufbewahrt werden (GoBD).',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      // Die OCR-Aufträge enthalten den erkannten Text – mitlöschen
      await tx.ocrJob.deleteMany({ where: { companyId, documentId: document.id } });
      await tx.document.delete({ where: { id: document.id } });
      await writeAudit(tx, {
        companyId,
        userId,
        action: 'document_delete',
        entity: 'Document',
        entityId: document.id,
        oldData: {
          fileName: document.fileName,
          documentType: document.documentType,
          projectId: document.projectId,
        },
      });
    });
    // Andere Schreibweisen desselben Pfads (./, doppelte /) zählen mit
    const target = normalizeStoragePath(document.storagePath);
    const candidates = await this.prisma.document.findMany({
      where: { companyId, storagePath: { endsWith: posix.basename(target) } },
      select: { storagePath: true },
    });
    const stillUsed = candidates.some((c) => normalizeStoragePath(c.storagePath) === target);
    if (!stillUsed) {
      await this.storage.remove(companyId, document.storagePath).catch((error) =>
        // Der Eintrag ist gelöscht; eine verwaiste Datei ist kein Grund für einen Fehler
        this.logger.warn({ msg: 'Datei konnte nicht gelöscht werden', documentId: id, error: String(error) }),
      );
    }
    return { deleted: true };
  }

  async getFileContent(companyId: string, id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const document = await this.findOne(companyId, id);
    const buffer = await this.storage.read(companyId, document.storagePath);
    return { buffer, fileName: document.fileName };
  }
}
