import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OcrService } from './ocr.service';
import { INSTANCE_ID, LEASE_SECONDS, OcrQueue } from './ocr-queue';

type UploadedFile = { originalname: string; buffer: Buffer; mimetype: string };

export const searchableText = (text: string) =>
  text.replaceAll(String.fromCharCode(0), '').replace(/\s+/g, ' ').trim();

// Texterkennung als Auftrag: die Datei wird sofort angenommen, die Erkennung
// läuft im Hintergrund (über die OcrQueue), das Ergebnis wird abgefragt.
// Die Datei liegt nur bis zur Verarbeitung im Speicher des Servers, der sie
// angenommen hat. Jeder Auftrag gibt alle 30 s ein Lebenszeichen; Aufträge
// ohne Lebenszeichen (Server abgestürzt oder neu gestartet) markiert jeder
// Server nach 2 Minuten als fehlgeschlagen – laufende Aufträge anderer Server
// bleiben unberührt.
@Injectable()
export class OcrJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OcrJobsService.name);
  private sweeper?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private ocr: OcrService,
    private queue: OcrQueue,
  ) {}

  async onModuleInit() {
    await this.sweep();
    clearInterval(this.sweeper);
    this.sweeper = setInterval(() => void this.sweep().catch(() => undefined), 60_000);
    this.sweeper.unref?.();
  }

  onModuleDestroy() {
    clearInterval(this.sweeper);
  }

  // Aufräumen für alle Firmen – bewusst ohne companyId-Filter über SQL
  async sweep() {
    const stale = await this.prisma.$queryRaw<{ documentId: string | null }[]>`
      UPDATE "OcrJob" SET status = 'failed', error = 'Abgebrochen: der Server wurde neu gestartet.',
        "finishedAt" = NOW()
      WHERE status IN ('queued', 'running')
        AND COALESCE("heartbeatAt", "createdAt") < NOW() - make_interval(secs => ${LEASE_SECONDS})
      RETURNING "documentId"`;
    if (stale.length)
      this.logger.warn({
        msg: 'Unterbrochene OCR-Aufträge als fehlgeschlagen markiert',
        count: stale.length,
      });
    // Dokumente, deren Texterkennung keinen laufenden Auftrag mehr hat
    // (abgebrochen oder verwaist) – ein neu gestarteter Auftrag setzt den Stand wieder
    await this.prisma.$executeRaw`
      UPDATE "Document" d SET "ocrStatus" = 'failed'
      WHERE d."ocrStatus" IN ('queued', 'running')
        AND NOT EXISTS (
          SELECT 1 FROM "OcrJob" j WHERE j."documentId" = d.id AND j.status IN ('queued', 'running')
        )`;
    return stale.length;
  }

  // Mit documentId: Texterkennung zu einem gespeicherten Dokument – Stand und
  // Text werden zusätzlich am Dokument abgelegt.
  async create(companyId: string, userId: string, file: UploadedFile, documentId?: string) {
    this.ocr.assertSupported(file);
    const job = await this.prisma.ocrJob.create({
      data: {
        companyId,
        userId,
        fileName: file.originalname,
        documentId,
        worker: INSTANCE_ID,
        heartbeatAt: new Date(),
      },
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
      const result = await this.queue.run(
        async () => {
          await this.prisma.ocrJob.update({
            where: { id },
            data: { status: 'running', heartbeatAt: new Date() },
          });
          await setDocument({ ocrStatus: 'running' });
          return this.ocr.extractFromFile(file);
        },
        // Lebenszeichen, solange der Auftrag wartet oder läuft
        () => this.prisma.ocrJob.updateMany({ where: { id, companyId }, data: { heartbeatAt: new Date() } }),
      );
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

  private view({
    companyId: _companyId,
    worker: _worker,
    heartbeatAt: _heartbeatAt,
    ...job
  }: Prisma.OcrJobGetPayload<object>) {
    return job;
  }
}
