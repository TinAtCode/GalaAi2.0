import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { OcrJobsService } from '../../src/ocr/ocr-jobs.service';
import { buildTestPdf } from '../fixtures/test-pdf';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

// Texterkennung als Auftrag: sofortige Annahme (202), Ergebnis per Abfrage.
// PDFs mit Textebene brauchen keine Bild-OCR – so läuft der Test ohne
// Sprachdaten für Tesseract.
describe('OCR-Aufträge', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${company.token}` });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'OCR GmbH');
  });

  afterAll(async () => {
    await app.close();
  });

  async function waitForJob(id: string) {
    for (let i = 0; i < 50; i++) {
      const res = await api().get(`/ocr/jobs/${id}`).set(auth()).expect(200);
      if (res.body.status === 'done' || res.body.status === 'failed') return res.body;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('OCR-Auftrag wurde nicht fertig');
  }

  it('nimmt eine Datei an, liefert die ID sofort und später das Ergebnis', async () => {
    const pdf = buildTestPdf('Rechnung Nr. 4711 Betrag 123,45 EUR');
    const created = await api()
      .post('/ocr/jobs')
      .set(auth())
      .attach('file', pdf, { filename: 'rechnung.pdf', contentType: 'application/pdf' })
      .expect(202);
    expect(created.body).toMatchObject({ fileName: 'rechnung.pdf', userId: company.userId });
    expect(['queued', 'running', 'done']).toContain(created.body.status);
    expect(created.body.companyId).toBeUndefined();

    const job = await waitForJob(created.body.id);
    expect(job).toMatchObject({
      status: 'done',
      result: { method: 'pdf-text-layer', guessedDocumentType: 'invoice' },
    });
    expect(job.result.text).toContain('Rechnung Nr. 4711');
    expect(job.finishedAt).toBeTruthy();
  });

  it('falscher Dateityp: sofort 400, kein Auftrag', async () => {
    await api()
      .post('/ocr/jobs')
      .set(auth())
      .attach('file', Buffer.from('hallo'), { filename: 'notiz.txt', contentType: 'text/plain' })
      .expect(400);
    expect(await prisma.ocrJob.count({ where: { fileName: 'notiz.txt' } })).toBe(0);
  });

  it('fremde Aufträge sind nicht sichtbar', async () => {
    const job = await prisma.ocrJob.findFirstOrThrow({ where: { companyId: company.companyId } });
    const other = await createCompany(app, prisma, 'Fremd OCR GmbH');
    await api()
      .get(`/ocr/jobs/${job.id}`)
      .set({ Authorization: `Bearer ${other.token}` })
      .expect(404);
  });

  it('nach einem Neustart gelten unterbrochene Aufträge als fehlgeschlagen', async () => {
    // ohne Lebenszeichen seit mehr als 2 Minuten (Server neu gestartet)
    const stuck = await prisma.ocrJob.create({
      data: {
        companyId: company.companyId,
        fileName: 'scan.pdf',
        status: 'running',
        heartbeatAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    });
    await app.get(OcrJobsService).onModuleInit();
    const job = await api().get(`/ocr/jobs/${stuck.id}`).set(auth()).expect(200);
    expect(job.body).toMatchObject({ status: 'failed', error: expect.stringContaining('neu gestartet') });
  });

  it('die Sofort-Variante /ocr/extract funktioniert weiter', async () => {
    const res = await api()
      .post('/ocr/extract')
      .set(auth())
      .attach('file', buildTestPdf('Angebot Nr. 99 Terrasse'), {
        filename: 'angebot.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(res.body).toMatchObject({ method: 'pdf-text-layer', guessedDocumentType: 'quote' });
  });
});
