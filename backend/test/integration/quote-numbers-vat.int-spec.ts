import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createApp, createCompany, createProject, fetchPdfText, resetDatabase, TestCompany } from './helpers';

describe('Angebotsnummern und Umsatzsteuer', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let a: TestCompany;
  let b: TestCompany;
  const setup: Record<string, { projectId: string; serviceId: string }> = {};
  const api = () => request(app.getHttpServer());
  const as = (c: TestCompany) => ({ Authorization: `Bearer ${c.token}` });
  const year = new Date().getFullYear();

  async function prepare(company: TestCompany) {
    const { projectId } = await createProject(app, company.token);
    const service = await api()
      .post('/services')
      .set(as(company))
      .send({ name: 'Pflege', unit: 'h' })
      .expect(201);
    await api()
      .post(`/services/${service.body.id}/components`)
      .set(as(company))
      .send({ laborMinutes: 60 })
      .expect(201);
    return { projectId, serviceId: service.body.id };
  }
  const createQuote = (company: TestCompany, extra: object = {}) =>
    api()
      .post('/quotes')
      .set(as(company))
      .send({
        projectId: setup[company.companyId].projectId,
        lineItems: [{ serviceId: setup[company.companyId].serviceId, quantity: 10 }],
        ...extra,
      });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    a = await createCompany(app, prisma, 'Nummern A');
    b = await createCompany(app, prisma, 'Nummern B');
    setup[a.companyId] = await prepare(a);
    setup[b.companyId] = await prepare(b);
  });

  afterAll(async () => {
    await app.close();
  });

  it('vergibt fortlaufende Nummern je Firma', async () => {
    const first = await createQuote(a).expect(201);
    const second = await createQuote(a).expect(201);
    const other = await createQuote(b).expect(201);
    expect(first.body.number).toBe(`A-${year}-0001`);
    expect(second.body.number).toBe(`A-${year}-0002`);
    expect(other.body.number).toBe(`A-${year}-0001`); // eigene Zählung je Firma
  });

  it('gleichzeitig angelegte Angebote bekommen verschiedene, lückenlose Nummern', async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => createQuote(a)));
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
    const numbers = responses.map((r) => r.body.number).sort();
    expect(numbers).toEqual([3, 4, 5, 6, 7, 8].map((n) => `A-${year}-000${n}`));
  });

  it('rechnet die Umsatzsteuer auf die Nettosumme (Standard 19 %, abweichend möglich)', async () => {
    // 10 h à 45 €/h + 15 % GK + 20 % Aufschlag = 62,10 €/h -> 621,00 € netto
    const standard = await createQuote(a).expect(201);
    expect(Number(standard.body.totalNet)).toBe(621);
    expect(Number(standard.body.vatRate)).toBe(19);
    expect(Number(standard.body.totalVat)).toBe(117.99);
    expect(Number(standard.body.totalGross)).toBe(738.99);

    const reduced = await createQuote(a, { vatRate: 7 }).expect(201);
    expect(Number(reduced.body.totalVat)).toBe(43.47);

    await createQuote(a, { vatRate: 120 }).expect(400);
  });

  it('das Angebot als PDF zeigt Nummer, Positionen und Bruttobetrag', async () => {
    const quote = await createQuote(a).expect(201);
    const pdf = await fetchPdfText(app, `/quotes/${quote.body.id}/pdf`, a.token);
    expect(pdf).toMatchObject({ status: 200, isPdf: true });
    for (const expected of [
      `Angebot ${quote.body.number}`,
      'Familie Muster',
      'Pflege',
      '621,00 €',
      '738,99 €',
    ]) {
      expect(pdf.text).toContain(expected);
    }
    expect((await fetchPdfText(app, `/quotes/${quote.body.id}/pdf`, b.token)).status).toBe(404);
  });

  it('der Standardsatz ist je Firma einstellbar', async () => {
    await api().patch('/company/settings').set(as(b)).send({ defaultVatRate: 0 }).expect(200);
    const quote = await createQuote(b).expect(201);
    expect(Number(quote.body.totalVat)).toBe(0);
    expect(Number(quote.body.totalGross)).toBe(Number(quote.body.totalNet));
  });
});
