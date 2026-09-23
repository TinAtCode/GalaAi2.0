import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createApp, createCompany, fetchPdfText, resetDatabase } from './helpers';

// Belege ohne Umsatzsteuer: Kleinunternehmer (§ 19 UStG) und
// Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG).
describe('Umsatzsteuer: § 19 und § 13b', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  // Firma mit vollständigen Rechnungsdaten, ein Kunde mit Projekt und eine
  // Leistung für 20 m² × 62,10 €.
  async function setup(name: string, settings: object, customer: object) {
    const company = await createCompany(app, prisma, name);
    const auth = { Authorization: `Bearer ${company.token}` };
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({
        street: 'Gartenstraße 1',
        postalCode: '50667',
        city: 'Köln',
        taxNumber: '214/5678/1234',
        email: 'info@betrieb.example',
        phone: '+49 221 1',
        iban: 'DE89370400440532013000',
        ...settings,
      })
      .expect(200);
    const c = await api()
      .post('/customers')
      .set(auth)
      .send({
        name: 'Kunde',
        street: 'Weg 1',
        postalCode: '50667',
        city: 'Köln',
        email: 'k@example.com',
        ...customer,
      })
      .expect(201);
    const property = await api()
      .post('/properties')
      .set(auth)
      .send({ customerId: c.body.id, label: 'Garten' });
    const project = await api()
      .post('/projects')
      .set(auth)
      .send({ propertyId: property.body.id, title: 'Pflaster' });
    const service = await api()
      .post('/services')
      .set(auth)
      .send({ name: 'Pflastern', unit: 'm2' })
      .expect(201);
    await api()
      .post(`/services/${service.body.id}/components`)
      .set(auth)
      .send({ laborMinutes: 60 })
      .expect(201);
    return { company, auth, customerId: c.body.id, projectId: project.body.id, serviceId: service.body.id };
  }

  async function invoiceFor(ctx: Awaited<ReturnType<typeof setup>>, quoteBody: object = {}) {
    const { auth } = ctx;
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({
        projectId: ctx.projectId,
        lineItems: [{ serviceId: ctx.serviceId, quantity: 20 }],
        ...quoteBody,
      })
      .expect(201);
    await api().post(`/quotes/${quote.body.id}/approve`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/send`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/outcome`).set(auth).send({ status: 'accepted' }).expect(201);
    const order = await api().post('/orders').set(auth).send({ quoteId: quote.body.id }).expect(201);
    const draft = await api()
      .post('/invoices/from-order')
      .set(auth)
      .send({ orderId: order.body.id, kind: 'final' })
      .expect(201);
    const issued = await api().post(`/invoices/${draft.body.id}/issue`).set(auth).send({}).expect(201);
    return { quote: quote.body, invoice: issued.body };
  }

  const xml = (id: string, token: string) =>
    api()
      .get(`/invoices/${id}/xrechnung`)
      .set({ Authorization: `Bearer ${token}` })
      .buffer(true)
      .parse((res, done) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
        res.on('end', () => done(null, body));
      });

  const save = (name: string, body: string) => {
    if (!process.env.XRECHNUNG_OUT) return;
    mkdirSync(process.env.XRECHNUNG_OUT, { recursive: true });
    writeFileSync(join(process.env.XRECHNUNG_OUT, `int-${name}.xml`), body);
  };

  it('Kleinunternehmer: Angebot und Rechnung ohne Umsatzsteuer mit Hinweis', async () => {
    const ctx = await setup('Klein GaLa', { smallBusiness: true }, {});
    // Ein gewünschter Steuersatz wird ignoriert: Kleinunternehmer berechnen keine USt
    const { quote, invoice } = await invoiceFor(ctx, { vatRate: 19 });
    expect(quote).toMatchObject({ vatTreatment: 'small_business' });
    expect(Number(quote.vatRate)).toBe(0);
    expect(Number(quote.totalGross)).toBe(1242);
    expect(invoice.vatTreatment).toBe('small_business');
    expect(Number(invoice.totalVat)).toBe(0);

    const pdf = await fetchPdfText(app, `/invoices/${invoice.id}/pdf`, ctx.company.token);
    expect(pdf.text).toContain('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.');
    const quotePdf = await fetchPdfText(app, `/quotes/${quote.id}/pdf`, ctx.company.token);
    expect(quotePdf.text).toContain('§ 19 UStG');

    const res = await xml(invoice.id, ctx.company.token).expect(200);
    expect(res.body).toContain('<ram:CategoryCode>E</ram:CategoryCode>');
    expect(res.body).toContain('<ram:ExemptionReason>Kleinunternehmer gemäß § 19 UStG</ram:ExemptionReason>');
    save('small-business', res.body);
  });

  it('§ 13b: Rechnung ohne Umsatzsteuer, E-Rechnung braucht die USt-IdNr. des Kunden', async () => {
    const ctx = await setup('Normal GaLa', {}, { name: 'Bau GmbH' });
    const { quote, invoice } = await invoiceFor(ctx, { vatTreatment: 'reverse_charge' });
    expect(quote.vatTreatment).toBe('reverse_charge');
    expect(Number(invoice.totalVat)).toBe(0);
    expect(Number(invoice.totalGross)).toBe(1242);

    const pdf = await fetchPdfText(app, `/invoices/${invoice.id}/pdf`, ctx.company.token);
    expect(pdf.text).toContain('Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG).');

    const missing = await xml(invoice.id, ctx.company.token).expect(400);
    expect(JSON.parse(missing.body).message).toContain('USt-IdNr. des Kunden');

    await api()
      .patch(`/customers/${ctx.customerId}`)
      .set(ctx.auth)
      .send({ vatId: 'DE987654321' })
      .expect(200);
    const res = await xml(invoice.id, ctx.company.token).expect(200);
    expect(res.body).toContain('<ram:CategoryCode>AE</ram:CategoryCode>');
    expect(res.body).toContain('<ram:ExemptionReasonCode>VATEX-EU-AE</ram:ExemptionReasonCode>');
    expect(res.body).toContain('<ram:ID schemeID="VA">DE987654321</ram:ID>');
    save('reverse-charge', res.body);

    // Das Storno übernimmt die Behandlung der Originalrechnung
    const cancellation = await api()
      .post(`/invoices/${invoice.id}/cancel`)
      .set(ctx.auth)
      .send({ reason: 'Test' })
      .expect(201);
    expect(cancellation.body.vatTreatment).toBe('reverse_charge');
    const cancelXml = await xml(cancellation.body.id, ctx.company.token).expect(200);
    expect(cancelXml.body).toContain('<ram:TypeCode>381</ram:TypeCode>');
    save('reverse-charge-cancellation', cancelXml.body);
  });

  it('ohne Grund bleibt 0 % als E-Rechnung gesperrt', async () => {
    const ctx = await setup('Null GaLa', {}, {});
    const { invoice } = await invoiceFor(ctx, { vatRate: 0 });
    expect(invoice.vatTreatment).toBe('standard');
    const res = await xml(invoice.id, ctx.company.token).expect(400);
    expect(JSON.parse(res.body).message).toContain('§ 19 oder § 13b');
  });
});
