import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

describe('Datei-Uploads', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let company: TestCompany;
  let auth: { Authorization: string };
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Upload GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
  });

  afterAll(async () => {
    await app.close();
  });

  it('Preisliste als XLSX: Vorschau, dann Übernahme', async () => {
    const preview = await api()
      .post('/data-guardian/price-list/upload')
      .set(auth)
      .attach('file', readFileSync(join(__dirname, '..', 'fixtures', 'preisliste.xlsx')), 'preisliste.xlsx')
      .expect(201);
    expect(preview.body.rows).toHaveLength(2);
    expect(preview.body.diff.newArticles).toHaveLength(2);
    expect(await prisma.article.count()).toBe(0); // Vorschau schreibt nichts

    await api()
      .post('/data-guardian/price-list/apply')
      .set(auth)
      .send({ rows: preview.body.rows })
      .expect(201);
    const mulch = await prisma.article.findFirstOrThrow({ where: { articleNumber: '4711' } });
    expect(Number(mulch.purchasePrice)).toBe(12.5);
  });

  it('das alte .xls-Format ergibt eine verständliche 400-Antwort', async () => {
    const res = await api()
      .post('/data-guardian/price-list/upload')
      .set(auth)
      .attach('file', readFileSync(join(__dirname, '..', 'fixtures', 'preisliste.xls')), 'preisliste.xls')
      .expect(400);
    expect(res.body.message).toMatch(/\.xlsx oder \.csv/);
  });

  it.each(['/data-guardian/price-list/upload', '/documents/upload', '/ocr/extract'])(
    '%s ohne Datei ergibt 400 statt 500',
    async (path) => {
      await api().post(path).set(auth).field('x', '1').expect(400);
    },
  );
});
