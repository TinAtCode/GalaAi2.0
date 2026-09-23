import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OcrService } from './ocr.service';
import { OcrQueue } from './ocr-queue';

type UploadedFile = { originalname: string; buffer: Buffer; mimetype: string };

export const searchableText = (text: string) =>
  text.replaceAll(String.fromCharCode(0), '').replace(/\s+/g, ' ').trim();

// Texterkennung als Auftrag: die Datei wird sofort angenommen, die Erkennung
// läuft im Hintergrund (über die OcrQueue), das Ergebnis wird abgefragt.
// Die Datei liegt nur bis zur Verarbeitung im Speicher; startet der Server
// neu, werden unterbrochene Aufträge als fehlgeschlagen markiert.
@Injectable()
export class OcrJobsService implements OnModuleInit {
  private readonly logger = new Logger(OcrJobsService.name);

  constructor(
    private prisma: PrismaService,
    private ocr: OcrService,
    private queue: OcrQueue,
  ) {}

  async onModuleInit() {
    // Aufräumen für alle Firmen – bewusst ohne companyId-Filter über SQL.
    const count = await this.prisma.$executeRaw`
      UPDATE "OcrJob" SET status = 'failed', error = 'Abgebrochen: der Server wurde neu gestartet.',
        "finishedAt" = NOW()
      WHERE status IN ('queued', 'running')`;
    if (count > 0) this.logger.warn({ msg: 'Unterbrochene OCR-Aufträge als fehlgeschlagen markiert', count });
    await this.prisma.$executeRaw`
      UPDATE "Document" SET "ocrStatus" = 'failed' WHERE "ocrStatus" IN ('queued', 'running')`;
  }

  // Mit documentId: Texterkennung zu einem gespeicherten Dokument – Stand und
  // Text werden zusätzlich am Dokument abgelegt.
  async create(companyId: string, userId: string, file: UploadedFile, documentId?: string) {
    this.ocr.assertSupported(file);
    const job = await this.prisma.ocrJob.create({
      data: { companyId, userId, fileName: file.originalname, documentId },
    });
    // Nicht abwarten: die Antwort geht sofort raus.
    void this.process(companyId, job.id, file, documentId);
    return this.view(job);
  }

  // Der Datei-Typ muss vor dem Speichern des Dokuments geprüft werden
  assertSupported(file: UploadedFile) {
    this.ocr.assertSupported(file);
  }

  private async process(companyId: string, id: string, file: UploadedFile, documentId?: string) {
    // updateMany: das Dokument kann inzwischen gelöscht sein
    const setDocument = (data: Prisma.DocumentUpdateManyMutationInput) =>
      documentId
        ? this.prisma.document.updateMany({ where: { id: documentId, companyId }, data })
        : Promise.resolve();
    try {
      const result = await this.queue.run(async () => {
        await this.prisma.ocrJob.update({ where: { id }, data: { status: 'running' } });
        await setDocument({ ocrStatus: 'running' });
        return this.ocr.extractFromFile(file);
      });
      await this.prisma.ocrJob.update({
        where: { id },
        data: { status: 'done', result: result as unknown as Prisma.InputJsonValue, finishedAt: new Date() },
      });
      // Für die Suche: Leerraum (Zeilenumbrüche) vereinheitlicht wie im
      // Suchbegriff; NUL-Zeichen (aus manchen PDFs) kann PostgreSQL nicht speichern
      await setDocument({ ocrStatus: 'done', ocrText: searchableText(result.text) });
    } catch (error) {
      const message =
        error instanceof BadRequestException ? error.message : 'Die Texterkennung ist fehlgeschlagen.';
      this.logger.error({ msg: 'OCR-Auftrag fehlgeschlagen', jobId: id, error: String(error) });
      await this.prisma.ocrJob
        .update({ where: { id }, data: { status: 'failed', error: message, finishedAt: new Date() } })
        .catch(() => undefined);
      await setDocument({ ocrStatus: 'failed' }).catch(() => undefined);
    }
  }

  async findOne(companyId: string, id: string) {
    const job = await this.prisma.ocrJob.findFirst({ where: { id, companyId } });
    if (!job) throw new NotFoundException('OCR-Auftrag nicht gefunden.');
    return this.view(job);
  }

  private view({ companyId: _companyId, ...job }: Prisma.OcrJobGetPayload<object>) {
    return job;
  }
}
