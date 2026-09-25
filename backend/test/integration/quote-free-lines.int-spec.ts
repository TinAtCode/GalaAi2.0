import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, createCompany, createProject, fetchPdfText, resetDatabase, TestCompany } from './helpers';

// Freie Positionen: Pauschalen und Einzelleistungen ohne Rezeptur, mit
// eigenem Text und Preis – gemischt mit Leistungen aus dem Katalog.
describe('Angebote mit freien Positionen', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  let projectId: string;
  let serviceId: string;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Frei GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    ({ projectId } = await createProject(app, company.token));
    const service = await api().post('/services').set(auth).send({ name: 'Rasen mähen', unit: 'm2' });
    serviceId = service.body.id;
    await api().post(`/services/${serviceId}/components`).set(auth).send({ laborMinutes: 1 });
  });

  afterAll(async () => {
    await app.close();
  });

  it('Katalog- und freie Positionen in einem Angebot, Summen exakt', async () => {
    const res = await api()
      .post('/quotes')
      .set(auth)
      .send({
        projectId,
        vatRate: 19,
        lineItems: [
          { serviceId, quantity: 100 },
          {
            description: 'Baustelleneinrichtung',
            unit: 'psch',
            quantity: 1,
            unitPrice: 250,
            costPerUnit: 120,
          },
          { description: '  Entsorgung Grünschnitt  ', unit: 't', quantity: 1.35, unitPrice: 89.99 },
        ],
      })
      .expect(201);
    const [catalog, setup, disposal] = res.body.lineItems;
    expect(res.body.lineItems.map((l: { position: number }) => l.position)).toEqual([1, 2, 3]);
    expect(catalog.serviceId).toBe(serviceId);
    expect(setup).toMatchObject({ serviceId: null, description: 'Baustelleneinrichtung', unit: 'psch' });
    expect(Number(setup.unitPrice)).toBe(250);
    expect(Number(setup.costPerUnit)).toBe(120);
    expect(Number(setup.marginPerUnit)).toBe(130);
    expect(Number(setup.lineTotal)).toBe(250);
    expect(disposal.description).toBe('Entsorgung Grünschnitt');
    expect(Number(disposal.lineTotal)).toBe(121.49); // 1,35 × 89,99 = 121,4865
    expect(Number(disposal.costPerUnit)).toBe(0);
    const net = Number(catalog.lineTotal) + 250 + 121.49;
    expect(Number(res.body.totalNet)).toBeCloseTo(net, 2);
    expect(Number(res.body.totalVat)).toBeCloseTo(Math.round(net * 19) / 100, 2);

    // Reihenfolge bleibt beim Lesen und im PDF erhalten
    const again = await api().get(`/quotes/${res.body.id}`).set(auth).expect(200);
    expect(again.body.lineItems.map((l: { description: string }) => l.description)).toEqual([
      'Rasen mähen',
      'Baustelleneinrichtung',
      'Entsorgung Grünschnitt',
    ]);
    const pdf = await fetchPdfText(app, `/quotes/${res.body.id}/pdf`, company.token);
    expect(pdf.text.indexOf('Rasen mähen')).toBeLessThan(pdf.text.indexOf('Baustelleneinrichtung'));
    expect(pdf.text.indexOf('Baustelleneinrichtung')).toBeLessThan(
      pdf.text.indexOf('Entsorgung Grünschnitt'),
    );
  });

  it('bis zur Rechnung: freie Positionen landen mit Text und Preis in der Schlussrechnung', async () => {
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({
        projectId,
        lineItems: [{ description: 'Pauschale Pflege', unit: 'psch', quantity: 1, unitPrice: 500 }],
      })
      .expect(201);
    await api().post(`/quotes/${quote.body.id}/approve`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/send`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/outcome`).set(auth).send({ status: 'accepted' }).expect(201);
    const order = await api().post('/orders').set(auth).send({ quoteId: quote.body.id }).expect(201);
    const invoice = await api()
      .post('/invoices/from-order')
      .set(auth)
      .send({ orderId: order.body.id, kind: 'final' })
      .expect(201);
    expect(invoice.body.lineItems[0]).toMatchObject({ description: 'Pauschale Pflege', unit: 'psch' });
    expect(Number(invoice.body.totalNet)).toBe(500);
    // Nachkalkulation: freie Positionen haben kein Soll aus einer Rezeptur
    await api().get(`/post-calculation/${projectId}`).set(auth).expect(200);
  });

  it('ungültige Positionen: 400 mit Hinweis', async () => {
    const send = (line: object) =>
      api()
        .post('/quotes')
        .set(auth)
        .send({ projectId, lineItems: [line] });
    await send({ quantity: 1, unitPrice: 10, unit: 'Stk' }).expect(400); // ohne Text
    await send({ description: 'Ohne Preis', unit: 'Stk', quantity: 1 }).expect(400);
    await send({ description: 'Negativ', unit: 'Stk', quantity: 1, unitPrice: -5 }).expect(400);
    await send({ description: 'Zu genau', unit: 'Stk', quantity: 1, unitPrice: 1.234 }).expect(400);
    // Mengen bis 3 Nachkommastellen (mm in m), genauer nicht
    await send({ description: 'Menge zu genau', unit: 'Stk', quantity: 1.0005, unitPrice: 1000 }).expect(400);
    await send({ serviceId, quantity: 1.0005 }).expect(400);
    await send({ description: '   ', unit: 'Stk', quantity: 1, unitPrice: 1 }).expect(400);
    await send({ description: 'Nur Leerzeichen als Einheit', unit: '   ', quantity: 1, unitPrice: 1 }).expect(
      400,
    );
    const mixed = await send({ serviceId, quantity: 1, unitPrice: 1 }).expect(400);
    expect(mixed.body.message).toContain('freie Position');
    await send({ serviceId: 'gibt-es-nicht', quantity: 1 }).expect(404);
  });

  it('ohne Einkaufsrechte: Kosten und Marge der freien Position bleiben verborgen', async () => {
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({
        projectId,
        lineItems: [
          { description: 'Pflanzarbeiten', unit: 'h', quantity: 2, unitPrice: 55, costPerUnit: 38 },
        ],
      })
      .expect(201);
    const roleIds = (await prisma.role.findMany({ where: { companyId: company.companyId } })).map(
      (r) => r.id,
    );
    await prisma.rolePermission.deleteMany({
      where: { roleId: { in: roleIds }, permission: { key: 'price.purchase.read' } },
    });
    const res = await api().get(`/quotes/${quote.body.id}`).set(auth).expect(200);
    expect(res.body.lineItems[0].costPerUnit).toBeUndefined();
    expect(res.body.lineItems[0].marginPerUnit).toBeUndefined();
    expect(Number(res.body.lineItems[0].unitPrice)).toBe(55);
  });

  it('Entwurf bearbeiten: Positionen und Steuer ersetzen, Summen neu; nach der Freigabe nicht mehr', async () => {
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({ projectId, lineItems: [{ serviceId, quantity: 10 }] })
      .expect(201);
    const edited = await api()
      .put(`/quotes/${quote.body.id}`)
      .set(auth)
      .send({
        vatRate: 7,
        lineItems: [
          { description: 'Erste Position', unit: 'psch', quantity: 1, unitPrice: 100 },
          { serviceId, quantity: 20 },
        ],
      })
      .expect(200);
    expect(edited.body.number).toBe(quote.body.number);
    expect(edited.body.lineItems.map((l: { description: string }) => l.description)).toEqual([
      'Erste Position',
      'Rasen mähen',
    ]);
    const catalogTotal = Number(edited.body.lineItems[1].lineTotal);
    expect(Number(edited.body.totalNet)).toBeCloseTo(100 + catalogTotal, 2);
    expect(Number(edited.body.vatRate)).toBe(7);
    expect(Number(edited.body.totalVat)).toBeCloseTo(Math.round((100 + catalogTotal) * 7) / 100, 2);
    expect(await prisma.quoteLineItem.count({ where: { quoteId: quote.body.id } })).toBe(2);

    await api().post(`/quotes/${quote.body.id}/approve`).set(auth).expect(201);
    const locked = await api()
      .put(`/quotes/${quote.body.id}`)
      .set(auth)
      .send({ lineItems: [{ serviceId, quantity: 1 }] })
      .expect(400);
    expect(locked.body.message).toContain('Entwurf');
    expect(await prisma.quoteLineItem.count({ where: { quoteId: quote.body.id } })).toBe(2);

    // fremde Firma: 404, Projekt lässt sich nicht umhängen
    const other = await createCompany(app, prisma, 'Fremd Angebot GmbH');
    await api()
      .put(`/quotes/${quote.body.id}`)
      .set({ Authorization: `Bearer ${other.token}` })
      .send({ lineItems: [{ description: 'Fremd', unit: 'psch', quantity: 1, unitPrice: 1 }] })
      .expect(404);
    await api()
      .put(`/quotes/${quote.body.id}`)
      .set(auth)
      .send({ projectId, lineItems: [{ serviceId, quantity: 1 }] })
      .expect(400);
  });

  it('Angebot kopieren: aktuelle Katalogpreise, freie Positionen + %, nur Projekte desselben Kunden', async () => {
    const original = await api()
      .post('/quotes')
      .set(auth)
      .send({
        projectId,
        introText: 'Pflege 2025',
        lineItems: [
          { serviceId, quantity: 200 },
          { description: 'Anfahrt', unit: 'psch', quantity: 1, unitPrice: 40, costPerUnit: 10 },
        ],
      })
      .expect(201);
    const oldCatalogPrice = Number(original.body.lineItems[0].unitPrice);
    // Kalkulation teurer: höherer Stundensatz → höherer Katalogpreis
    const settings = await api().get('/company/settings').set(auth).expect(200);
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({ hourlyLaborRate: Number(settings.body.hourlyLaborRate) + 30 })
      .expect(200);

    // neues Jahresprojekt am selben Objekt
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const nextYear = await prisma.project.create({
      data: { companyId: company.companyId, propertyId: project.propertyId, title: 'Pflege 2026' },
    });
    const copy = await api()
      .post(`/quotes/${original.body.id}/copy`)
      .set(auth)
      .send({ projectId: nextYear.id, freeLinePercent: 5 })
      .expect(201);
    expect(copy.body).toMatchObject({ projectId: nextYear.id, status: 'draft', introText: 'Pflege 2025' });
    expect(copy.body.id).not.toBe(original.body.id);
    const [catalog, free] = copy.body.lineItems;
    expect(catalog.serviceId).toBe(serviceId);
    expect(Number(catalog.quantity)).toBe(200);
    expect(Number(catalog.unitPrice)).toBeGreaterThan(oldCatalogPrice);
    expect(free).toMatchObject({ description: 'Anfahrt', unit: 'psch' });
    expect(Number(free.unitPrice)).toBe(42);
    // Kosten bleiben (ein Test weiter oben nimmt das Recht auf Einkaufspreise – daher aus der DB)
    const stored = await prisma.quoteLineItem.findUniqueOrThrow({ where: { id: free.id } });
    expect(Number(stored.costPerUnit)).toBe(10);

    // ohne Ziel: im selben Projekt; Original unverändert
    const same = await api().post(`/quotes/${original.body.id}/copy`).set(auth).send({}).expect(201);
    expect(same.body.projectId).toBe(projectId);
    const untouched = await api().get(`/quotes/${original.body.id}`).set(auth).expect(200);
    expect(Number(untouched.body.lineItems[0].unitPrice)).toBe(oldCatalogPrice);

    // gelöschte Leistung wird zur freien Position mit altem Preis
    const temp = await api()
      .post('/services')
      .set(auth)
      .send({ name: 'Laub saugen', unit: 'm2' })
      .expect(201);
    await api().post(`/services/${temp.body.id}/components`).set(auth).send({ laborMinutes: 2 });
    const withTemp = await api()
      .post('/quotes')
      .set(auth)
      .send({ projectId, lineItems: [{ serviceId: temp.body.id, quantity: 10 }] })
      .expect(201);
    // (in der App nicht löschbar – Absicherung für Altdaten)
    await prisma.serviceComponent.deleteMany({ where: { serviceId: temp.body.id } });
    await prisma.service.delete({ where: { id: temp.body.id } });
    const orphan = await api().post(`/quotes/${withTemp.body.id}/copy`).set(auth).send({}).expect(201);
    expect(orphan.body.lineItems[0]).toMatchObject({ serviceId: null, description: 'Laub saugen' });
    expect(Number(orphan.body.lineItems[0].unitPrice)).toBe(Number(withTemp.body.lineItems[0].unitPrice));

    // anderer Kunde → 400, fremde Firma → 404
    const { projectId: otherCustomersProject } = await createProject(app, company.token);
    await api()
      .post(`/quotes/${original.body.id}/copy`)
      .set(auth)
      .send({ projectId: otherCustomersProject })
      .expect(400);
    const foreign = await createCompany(app, prisma, 'Fremd Kopie GmbH');
    await api()
      .post(`/quotes/${original.body.id}/copy`)
      .set({ Authorization: `Bearer ${foreign.token}` })
      .send({})
      .expect(404);
    await api().post(`/quotes/${original.body.id}/copy`).set(auth).send({ freeLinePercent: 500 }).expect(400);
  });

  it('Kopie eines Angebots ohne USt (§ 19) bekommt den aktuellen Steuersatz der Firma', async () => {
    const created = await api()
      .post('/quotes')
      .set(auth)
      .send({ projectId, lineItems: [{ description: 'Pflege', unit: 'psch', quantity: 1, unitPrice: 100 }] })
      .expect(201);
    // wie ein altes Angebot aus der Zeit als Kleinunternehmer
    await prisma.quote.update({
      where: { id: created.body.id },
      data: { vatTreatment: 'small_business', vatRate: 0, totalVat: 0, totalGross: 100 },
    });
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: (await prisma.quote.findUniqueOrThrow({ where: { id: created.body.id } })).companyId },
    });
    const copy = await api().post(`/quotes/${created.body.id}/copy`).set(auth).send({}).expect(201);
    expect(copy.body.vatTreatment).toBe(company.smallBusiness ? 'small_business' : 'standard');
    expect(Number(copy.body.vatRate)).toBe(company.smallBusiness ? 0 : Number(company.defaultVatRate));
  });
});
