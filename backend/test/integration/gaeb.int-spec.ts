import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { parseGaeb } from '../../src/quotes/gaeb';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// GAEB: Leistungsverzeichnis einlesen → Angebotsentwurf → Preise eintragen →
// Angebotsabgabe X84 mit denselben Ordnungszahlen und Mengen.
describe('GAEB-Leistungsverzeichnis', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  let projectId: string;
  const api = () => request(app.getHttpServer());
  const lv = readFileSync(join(__dirname, '../fixtures/gaeb/aussenanlagen.X83'));
  const binary = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Grün & Stein GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    ({ projectId } = await createProject(app, company.token));
    // eine Leistung heißt wie eine LV-Position: Preis kommt aus der Kalkulation
    const service = await api()
      .post('/services')
      .set(auth)
      .send({ name: 'Betonpflaster verlegen', unit: 'm2' });
    await api().post(`/services/${service.body.id}/components`).set(auth).send({ laborMinutes: 30 });
  });

  afterAll(async () => {
    await app.close();
  });

  it('einlesen, Preise eintragen, als X84 abgeben', async () => {
    const res = await api()
      .post(`/quotes/gaeb-import/${projectId}`)
      .set(auth)
      .attach('file', lv, 'aussenanlagen.X83')
      .expect(201);
    expect(res.body).toMatchObject({ imported: 3, matched: 1 });
    expect(res.body.skipped).toHaveLength(3);

    const quote = (await api().get(`/quotes/${res.body.quoteId}`).set(auth).expect(200)).body;
    expect(quote.status).toBe('draft');
    expect(quote.introText).toContain('Außenanlagen & Pflaster');
    expect(
      quote.lineItems.map((l: { gaebOz: string; quantity: string; unit: string }) => [
        l.gaebOz,
        Number(l.quantity),
        l.unit,
      ]),
    ).toEqual([
      // Menge genau wie im LV, nicht nach der Einheitenregel gerundet
      ['01.0010', 125.5, 'm²'],
      ['01.0020', 42, 'm³'],
      ['02.0010', 80, 'm²'],
    ]);
    const paving = quote.lineItems[2];
    expect(paving.serviceId).toBeTruthy();
    expect(Number(paving.unitPrice)).toBeGreaterThan(0);

    // ohne Preise keine Abgabe
    const early = await api().get(`/quotes/${quote.id}/gaeb`).set(auth).expect(400);
    expect(early.body.message).toContain('noch keinen Preis');

    // Preise im Entwurf eintragen (wie das Formular: gaebOz bleibt erhalten) plus eine Zusatzposition
    const lineItems = quote.lineItems.map(
      (
        l: {
          serviceId: string | null;
          gaebOz: string;
          description: string;
          unit: string;
          quantityExact: string;
        },
        i: number,
      ) =>
        l.serviceId
          ? {
              serviceId: l.serviceId,
              gaebOz: l.gaebOz,
              quantity: Number(l.quantityExact),
              roundingDecimals: 3,
            }
          : {
              gaebOz: l.gaebOz,
              description: l.description,
              unit: l.unit,
              quantity: Number(l.quantityExact),
              roundingDecimals: 3,
              unitPrice: [4.2, 18][i],
            },
    );
    lineItems.push({ description: 'Rasen ansäen', unit: 'm2', quantity: 10, unitPrice: 5 });
    const updated = await api().put(`/quotes/${quote.id}`).set(auth).send({ lineItems }).expect(200);
    expect(updated.body.lineItems.map((l: { gaebOz: string | null }) => l.gaebOz)).toEqual([
      '01.0010',
      '01.0020',
      '02.0010',
      null,
    ]);

    const x84 = await api().get(`/quotes/${quote.id}/gaeb`).set(auth).buffer(true).parse(binary).expect(200);
    expect(x84.headers['content-disposition']).toMatch(/Angebot_A-\d{4}-\d{4}\.X84/);
    const xml = (x84.body as Buffer).toString('utf8');
    expect(xml).toContain('<DP>84</DP>');
    expect(xml).toContain('<NamePrj>2026-117</NamePrj>');
    expect(xml).toContain('<Name1>Grün &amp; Stein GmbH</Name1>');
    const back = parseGaeb(xml);
    expect(back.items.map((i) => [i.oz, i.quantity])).toEqual([
      ['01.0010', 125.5],
      ['01.0020', 42],
      ['02.0010', 80],
      ['03.0010', 10],
    ]);
    expect(xml).toMatch(
      /<Item RNoPart="0010">\s*<Qty>125\.500<\/Qty>\s*<QU>m2<\/QU>\s*<UP>4\.20<\/UP>\s*<IT>527\.10<\/IT>/,
    );
    const total = Number(/<\/BoQBody>\s*<Totals><Total>([\d.]+)<\/Total><\/Totals>\s*<\/BoQ>/.exec(xml)![1]);
    expect(total).toBeCloseTo(Number(updated.body.totalNet), 2);
  });

  it('falsche Dateien und fremde Projekte werden abgelehnt', async () => {
    const bad = await api()
      .post(`/quotes/gaeb-import/${projectId}`)
      .set(auth)
      .attach('file', Buffer.from('<Invoice/>'), 'rechnung.xml')
      .expect(400);
    expect(bad.body.message).toContain('GAEB');
    const other = await createCompany(app, prisma, 'Andere GmbH');
    await api()
      .post(`/quotes/gaeb-import/${projectId}`)
      .set({ Authorization: `Bearer ${other.token}` })
      .attach('file', lv, 'lv.X83')
      .expect(404);
    const quote = await prisma.quote.findFirstOrThrow({ where: { companyId: company.companyId } });
    await api()
      .get(`/quotes/${quote.id}/gaeb`)
      .set({ Authorization: `Bearer ${other.token}` })
      .expect(404);
  });
});
