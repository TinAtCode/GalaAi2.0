import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OcrService } from './ocr.service';
import { OcrQueue } from './ocr-queue';

type UploadedFile = { originalname: string; buffer: Buffer; mimetype: string };

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
  }

  async create(companyId: string, userId: string, file: UploadedFile) {
    this.ocr.assertSupported(file);
    const job = await this.prisma.ocrJob.create({
      data: { companyId, userId, fileName: file.originalname },
    });
    // Nicht abwarten: die Antwort geht sofort raus.
    void this.process(job.id, file);
    return this.view(job);
  }

  private async process(id: string, file: UploadedFile) {
    try {
      const result = await this.queue.run(async () => {
        await this.prisma.ocrJob.update({ where: { id }, data: { status: 'running' } });
        return this.ocr.extractFromFile(file);
      });
      await this.prisma.ocrJob.update({
        where: { id },
        data: { status: 'done', result: result as unknown as Prisma.InputJsonValue, finishedAt: new Date() },
      });
    } catch (error) {
      const message =
        error instanceof BadRequestException ? error.message : 'Die Texterkennung ist fehlgeschlagen.';
      this.logger.error({ msg: 'OCR-Auftrag fehlgeschlagen', jobId: id, error: String(error) });
      await this.prisma.ocrJob
        .update({ where: { id }, data: { status: 'failed', error: message, finishedAt: new Date() } })
        .catch(() => undefined);
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
