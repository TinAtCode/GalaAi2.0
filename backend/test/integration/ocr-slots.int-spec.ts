import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { OcrQueue, PrismaSlotStore } from '../../src/ocr/ocr-queue';
import { OcrJobsService } from '../../src/ocr/ocr-jobs.service';
import { OcrService } from '../../src/ocr/ocr.service';
import { resetDatabase } from './helpers';

// Plätze für die Texterkennung in der Datenbank: über mehrere Server hinweg
// höchstens OCR_CONCURRENCY gleichzeitig; verwaiste Aufträge werden aufgeräumt
describe('OCR-Plätze über mehrere Server', () => {
  const prisma = new PrismaService();
  const raw = new PrismaClient();

  beforeAll(async () => {
    await prisma.$connect();
    await resetDatabase(raw);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await raw.$disconnect();
  });

  it('vergibt jeden Platz nur einmal, auch bei gleichzeitigen Anfragen', async () => {
    const serverA = new PrismaSlotStore(prisma);
    const serverB = new PrismaSlotStore(prisma);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => (i % 2 ? serverA : serverB).acquire(`h${i}`, 2)),
    );
    expect(results.filter(Boolean)).toHaveLength(2);
    const holders = results.map((ok, i) => (ok ? `h${i}` : null)).filter(Boolean) as string[];
    await serverA.release(holders[0]);
    expect(await serverB.acquire('neu', 2)).toBe(true);
    // abgelaufener Platz (Server abgestürzt) wird wieder frei
    await raw.$executeRaw`UPDATE "OcrSlot" SET "leasedUntil" = NOW() - interval '1 second' WHERE holder = ${holders[1]}`;
    expect(await serverA.acquire('nach-absturz', 2)).toBe(true);
    await raw.$executeRaw`UPDATE "OcrSlot" SET holder = NULL, "leasedUntil" = NULL`;
  });

  it('Warteschlange mit Datenbank-Plätzen: zwei Server, ein Platz', async () => {
    process.env.OCR_CONCURRENCY = '1';
    process.env.OCR_SLOT_POLL_MS = '20';
    const a = new OcrQueue(new PrismaSlotStore(prisma));
    const b = new OcrQueue(new PrismaSlotStore(prisma));
    const order: string[] = [];
    let release!: () => void;
    const first = a.run(async () => {
      order.push('a:start');
      await new Promise<void>((r) => (release = r));
      order.push('a:end');
    });
    await new Promise((r) => setTimeout(r, 100));
    const second = b.run(async () => {
      order.push('b:start');
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(order).toEqual(['a:start']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
    delete process.env.OCR_CONCURRENCY;
    delete process.env.OCR_SLOT_POLL_MS;
  });

  it('räumt nur Aufträge ohne Lebenszeichen auf – laufende anderer Server bleiben', async () => {
    const company = await raw.company.create({ data: { name: 'OCR GmbH' } });
    const old = new Date(Date.now() - 10 * 60 * 1000);
    const stale = await raw.ocrJob.create({
      data: {
        companyId: company.id,
        fileName: 'alt.pdf',
        status: 'running',
        worker: 'abgestürzt',
        heartbeatAt: old,
      },
    });
    const alive = await raw.ocrJob.create({
      data: {
        companyId: company.id,
        fileName: 'neu.pdf',
        status: 'running',
        worker: 'anderer',
        heartbeatAt: new Date(),
      },
    });
    const service = new OcrJobsService(prisma, {} as OcrService, new OcrQueue());
    expect(await service.sweep()).toBe(1);
    expect((await raw.ocrJob.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('failed');
    expect((await raw.ocrJob.findUniqueOrThrow({ where: { id: alive.id } })).status).toBe('running');
  });
});
