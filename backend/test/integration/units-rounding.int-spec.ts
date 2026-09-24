import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { createApp, createCompany, fetchPdfText, resetDatabase, TestCompany } from './helpers';

type Line = {
  description: string;
  unit: string;
  quantity: string;
  quantityExact: string;
  roundingSource: string;
  lineTotal: string;
};

// Einheiten und Rundung der Mengen: Firma → Einheit → Leistung → Position;
// die genaue Menge bleibt für die Nachkalkulation erhalten.
describe('Einheiten und Rundung', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  let projectId: string;
  let paving: string; // Pflaster: ganze m², aufrunden
  let mowing: string; // Rasen mähen: ohne eigene Regel
  const api = () => request(app.getHttpServer());
  let propertyId: string;
  // eigenes Projekt je Test (Nachkalkulation und Auftrag gehören zum Projekt)
  const newProject = async (title: string) =>
    (await api().post('/projects').set(auth).send({ propertyId, title }).expect(201)).body.id as string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Rund GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({
        street: 'Gartenstraße 1',
        postalCode: '50667',
        city: 'Köln',
        taxNumber: '214/5678/1234',
        email: 'info@rund.example',
        phone: '+49 221 12345',
        iban: 'DE89370400440532013000',
      })
      .expect(200);
    const customer = await api()
      .post('/customers')
      .set(auth)
      .send({
        name: 'Familie Berger',
        email: 'berger@example.com',
        street: 'Lindenweg 3',
        postalCode: '50667',
        city: 'Köln',
      })
      .expect(201);
    const property = await api()
      .post('/properties')
      .set(auth)
      .send({ customerId: customer.body.id, label: 'Garten' });
    propertyId = property.body.id;
    projectId = await newProject('Hof');

    const pavingRes = await api()
      .post('/services')
      .set(auth)
      .send({ name: 'Pflaster verlegen', unit: 'qm', quantityDecimals: 0, quantityRounding: 'up' })
      .expect(201);
    paving = pavingRes.body.id;
    expect(pavingRes.body.unit).toBe('m²'); // Schreibweise vereinheitlicht
    await api().post(`/services/${paving}/components`).set(auth).send({ laborMinutes: 30 }).expect(201);
    mowing = (await api().post('/services').set(auth).send({ name: 'Rasen mähen', unit: 'm2' }).expect(201))
      .body.id;
    await api().post(`/services/${mowing}/components`).set(auth).send({ laborMinutes: 1 }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('Einheitenkatalog mit Anpassungen der Firma und eigenen Einheiten', async () => {
    let list = (await api().get('/units').set(auth).expect(200)).body;
    expect(list.company).toEqual({ quantityDecimals: 2, quantityRounding: 'half_up' });
    expect(list.units.find((u: { code: string }) => u.code === 'Stk')).toMatchObject({
      label: 'Stück',
      dimension: 'count',
      defaultDecimals: 0,
      decimals: null,
    });

    // m² in dieser Firma mit 1 Nachkommastelle; eigene Einheit "Rolle" ganzzahlig, aufrunden
    await api().put('/units/qm').set(auth).send({ decimals: 1 }).expect(200);
    await api()
      .put('/units/Rolle')
      .set(auth)
      .send({ label: 'Rolle Vlies', decimals: 0, rounding: 'up' })
      .expect(200);
    list = (await api().get('/units').set(auth).expect(200)).body;
    expect(list.units.find((u: { code: string }) => u.code === 'm²')).toMatchObject({ decimals: 1 });
    expect(list.units.find((u: { code: string }) => u.code === 'Rolle')).toMatchObject({
      custom: true,
      label: 'Rolle Vlies',
      decimals: 0,
      rounding: 'up',
    });
  });

  it('Rundung je Stufe: Leistung, Einheit, Firma, Position', async () => {
    const res = await api()
      .post('/quotes')
      .set(auth)
      .send({
        projectId,
        vatRate: 19,
        lineItems: [
          // Leistung: ganze m², aufrunden
          { serviceId: paving, quantity: 12.31 },
          // Einheit m² (angepasst): 1 Nachkommastelle
          { serviceId: mowing, quantity: 250.46 },
          // eigene Einheit Rolle: aufrunden auf ganze
          { description: 'Unkrautvlies', unit: 'Rolle', quantity: 2.2, unitPrice: 40 },
          // Firma: 2 Nachkommastellen; mm-genaue Länge in Metern
          { description: 'Kantenstein schneiden', unit: 'Band', quantity: 3.456, unitPrice: 10 },
          // Position überschreibt die Leistung: genau, 3 Nachkommastellen
          { serviceId: paving, quantity: 1.125, roundingDecimals: 3 },
          // Stück ganzzahlig (Katalog), Schritt an der Position: 0,5 h
          {
            description: 'Fahrzeit',
            unit: 'Std',
            quantity: 1.2,
            unitPrice: 50,
            roundingStep: 0.5,
            roundingMode: 'up',
          },
        ],
      })
      .expect(201);
    const lines: Line[] = res.body.lineItems;
    const view = lines.map((l) => [l.unit, Number(l.quantity), Number(l.quantityExact), l.roundingSource]);
    expect(view).toEqual([
      ['m²', 13, 12.31, 'master'],
      ['m²', 250.5, 250.46, 'unit'],
      ['Rolle', 3, 2.2, 'unit'],
      ['Band', 3.46, 3.456, 'company'],
      ['m²', 1.125, 1.125, 'position'],
      ['h', 1.5, 1.2, 'position'],
    ]);
    // Summe aus der gerundeten Menge
    expect(Number(lines[2].lineTotal)).toBe(120);
    expect(Number(lines[3].lineTotal)).toBe(34.6);
    expect(Number(lines[5].lineTotal)).toBe(75);

    // PDF zeigt die gerundeten Mengen mit bis zu 3 Nachkommastellen
    const pdf = await fetchPdfText(app, `/quotes/${res.body.id}/pdf`, company.token);
    expect(pdf.text).toContain('1,125');
    expect(pdf.text).toContain('250,5');
  });

  it('Nachkalkulation rechnet mit der genauen, Rechnung und E-Rechnung mit der gerundeten Menge', async () => {
    const ownProject = await newProject('Einfahrt');
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({ projectId: ownProject, vatRate: 19, lineItems: [{ serviceId: paving, quantity: 12.31 }] })
      .expect(201);
    await api().post(`/quotes/${quote.body.id}/approve`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/send`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/outcome`).set(auth).send({ status: 'accepted' }).expect(201);
    const order = await api().post('/orders').set(auth).send({ quoteId: quote.body.id }).expect(201);

    const post = await api().get(`/post-calculation/${ownProject}`).set(auth).expect(200);
    // 12,31 m² × 30 Min = 369,3 Min (nicht 13 × 30 = 390)
    expect(post.body.labor.planned).toBeCloseTo(369.3);

    const draft = await api()
      .post('/invoices/from-order')
      .set(auth)
      .send({ orderId: order.body.id, kind: 'final' })
      .expect(201);
    const issued = await api().post(`/invoices/${draft.body.id}/issue`).set(auth).send({}).expect(201);
    expect(Number(issued.body.lineItems[0].quantity)).toBe(13);
    const xml = await api().get(`/invoices/${issued.body.id}/xrechnung`).set(auth);
    expect(xml.status).toBe(200);
    expect(xml.text).toContain('<ram:BilledQuantity unitCode="MTK">13.00</ram:BilledQuantity>');
    if (process.env.XRECHNUNG_OUT) {
      mkdirSync(process.env.XRECHNUNG_OUT, { recursive: true });
      writeFileSync(join(process.env.XRECHNUNG_OUT, 'int-rounding.xml'), xml.text);
    }
  });

  it('E-Rechnung mit 3 Nachkommastellen bei der Menge', async () => {
    const ownProject = await newProject('Kiesweg');
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({
        projectId: ownProject,
        vatRate: 19,
        lineItems: [{ description: 'Kies', unit: 'm3', quantity: 0.125, unitPrice: 80, roundingDecimals: 3 }],
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
    const xml = await api().get(`/invoices/${issued.body.id}/xrechnung`).set(auth);
    expect(xml.status).toBe(200);
    expect(xml.text).toContain('<ram:BilledQuantity unitCode="MTQ">0.125</ram:BilledQuantity>');
    expect(xml.text).toContain('<ram:LineTotalAmount>10.00</ram:LineTotalAmount>');
    if (process.env.XRECHNUNG_OUT) {
      writeFileSync(join(process.env.XRECHNUNG_OUT, 'int-rounding-3dp.xml'), xml.text);
    }
  });

  it('Rundung am Firmenstandard ändern; Einheiten ändern nur mit Stammdaten-Recht', async () => {
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({ quantityDecimals: 1, quantityRounding: 'down' })
      .expect(200);
    const res = await api()
      .post('/quotes')
      .set(auth)
      .send({ projectId, lineItems: [{ description: 'Mulch', unit: 'Sack?', quantity: 4.79, unitPrice: 5 }] })
      .expect(201);
    expect(Number(res.body.lineItems[0].quantity)).toBe(4.7);

    const role = await prisma.role.create({
      data: {
        companyId: company.companyId,
        name: 'Nur Kunden',
        permissions: { create: { permission: { connect: { key: 'customer.read' } } } },
      },
    });
    await prisma.user.create({
      data: {
        companyId: company.companyId,
        email: 'leser@rund.test',
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: 'L',
        lastName: 'L',
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api().post('/auth/login').send({ email: 'leser@rund.test', password: 'test12345' });
    const reader = { Authorization: `Bearer ${login.body.accessToken}` };
    await api().get('/units').set(reader).expect(200);
    await api().put('/units/m').set(reader).send({ decimals: 0 }).expect(403);
    await api().delete('/units/Rolle').set(reader).expect(403);

    // andere Firma sieht die Anpassungen nicht
    const other = await createCompany(app, prisma, 'Fremd Rund GmbH');
    const foreign = (
      await api()
        .get('/units')
        .set({ Authorization: `Bearer ${other.token}` })
        .expect(200)
    ).body;
    expect(foreign.units.find((u: { code: string }) => u.code === 'Rolle')).toBeUndefined();
    expect(foreign.units.find((u: { code: string }) => u.code === 'm²').decimals).toBeNull();

    await api().delete('/units/Rolle').set(auth).expect(200);
    await api().delete('/units/Rolle').set(auth).expect(404);
  });

  it('bestehende Positionen (Regel aus der Migration) bleiben beim erneuten Speichern unverändert', async () => {
    // so markiert die Migration alte Positionen: eigene Regel, 3 Nachkommastellen
    const legacy = { roundingDecimals: 3, roundingMode: 'half_up' };
    const draft = await api()
      .post('/quotes')
      .set(auth)
      .send({
        projectId,
        lineItems: [
          { description: 'Randsteine', unit: 'Stk', quantity: 2.5, unitPrice: 10, ...legacy },
          {
            description: 'Fahrzeit',
            unit: 'h',
            quantity: 1.2,
            unitPrice: 50,
            roundingStep: 0.5,
            roundingMode: 'up',
          },
        ],
      })
      .expect(201);
    expect(Number(draft.body.totalNet)).toBe(100); // 2,5 × 10 + 1,5 × 50
    // Entwurf erneut speichern, wie das Formular es tut (genaue Menge + Regel der Position)
    const again = await api()
      .put(`/quotes/${draft.body.id}`)
      .set(auth)
      .send({
        lineItems: draft.body.lineItems.map(
          (
            l: Line & {
              roundingDecimals: number | null;
              roundingMode: string | null;
              roundingStep: string | null;
              unitPrice: string;
            },
          ) => ({
            description: l.description,
            unit: l.unit,
            quantity: Number(l.quantityExact),
            unitPrice: Number(l.unitPrice),
            ...(l.roundingDecimals != null ? { roundingDecimals: l.roundingDecimals } : {}),
            ...(l.roundingMode ? { roundingMode: l.roundingMode } : {}),
            ...(l.roundingStep ? { roundingStep: Number(l.roundingStep) } : {}),
          }),
        ),
      })
      .expect(200);
    expect(again.body.lineItems.map((l: Line) => Number(l.quantity))).toEqual([2.5, 1.5]);
    expect(Number(again.body.totalNet)).toBe(100);
  });

  it('Mengen mit mehr als 3 Nachkommastellen oder ungültige Regeln werden abgelehnt', async () => {
    const bad = (line: object) =>
      api()
        .post('/quotes')
        .set(auth)
        .send({ projectId, lineItems: [{ description: 'X', unit: 'm', unitPrice: 1, ...line }] })
        .expect(400);
    await bad({ quantity: 1.2345 });
    await bad({ quantity: 1, roundingDecimals: 4 });
    await bad({ quantity: 1, roundingMode: 'bankers' });
    await api().put('/units/m').set(auth).send({ step: 0 }).expect(400);
  });
});
