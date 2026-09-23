import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createApp, createCompany, fetchPdfText, resetDatabase, TestCompany } from './helpers';

// Kompletter Rechnungsablauf gegen PostgreSQL: Abschlag -> Schlussrechnung
// mit Abzug -> Storno, inklusive Nummernkreis, Pflichtangaben und
// Unveränderlichkeit (Datenbank-Trigger).
describe('Rechnungen', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let company: TestCompany;
  let auth: { Authorization: string };
  let projectId: string;
  let orderId: string;
  let customerId: string;
  const year = new Date().getFullYear();
  const api = () => request(app.getHttpServer());
  const R = (n: number) => `R-${year}-${String(n).padStart(4, '0')}`;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Rechnung GmbH');
    auth = { Authorization: `Bearer ${company.token}` };

    const customer = await api()
      .post('/customers')
      .set(auth)
      .send({ name: 'Familie Berger', street: 'Lindenweg 3', postalCode: '50667', city: 'Köln' })
      .expect(201);
    customerId = customer.body.id;
    const property = await api()
      .post('/properties')
      .set(auth)
      .send({ customerId: customer.body.id, label: 'Garten' })
      .expect(201);
    const project = await api()
      .post('/projects')
      .set(auth)
      .send({ propertyId: property.body.id, title: 'Terrasse' })
      .expect(201);
    projectId = project.body.id;
    const service = await api()
      .post('/services')
      .set(auth)
      .send({ name: 'Terrasse verlegen', unit: 'm2' })
      .expect(201);
    await api()
      .post(`/services/${service.body.id}/components`)
      .set(auth)
      .send({ laborMinutes: 60 })
      .expect(201);
    // 20 m² × 62,10 € = 1.242,00 € netto
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({ projectId, lineItems: [{ serviceId: service.body.id, quantity: 20 }] })
      .expect(201);
    await api().post(`/quotes/${quote.body.id}/approve`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/send`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/outcome`).set(auth).send({ status: 'accepted' }).expect(201);
    const order = await api().post('/orders').set(auth).send({ quoteId: quote.body.id }).expect(201);
    orderId = order.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const draft = (body: object) =>
    api()
      .post('/invoices/from-order')
      .set(auth)
      .send({ orderId, ...body });
  const issue = (id: string) => api().post(`/invoices/${id}/issue`).set(auth).send({});

  it('ohne Firmenanschrift und Steuernummer lässt sich keine Rechnung ausstellen', async () => {
    const partial = await draft({ kind: 'partial', percent: 30 }).expect(201);
    const res = await issue(partial.body.id).expect(400);
    expect(res.body.message).toContain('Steuernummer oder USt-IdNr.');

    await api()
      .patch('/company/settings')
      .set(auth)
      .send({ street: 'Gartenstraße 1', postalCode: '50667', city: 'Köln', taxNumber: '214/5678/1234' })
      .expect(200);
    // Die Nummer wurde beim Fehlversuch nicht verbraucht
    const issued = await issue(partial.body.id).expect(201);
    expect(issued.body).toMatchObject({ status: 'issued', number: R(1) });
    expect(Number(issued.body.totalNet)).toBe(372.6); // 30 % von 1.242,00
    expect(Number(issued.body.totalVat)).toBe(70.79);
    expect(issued.body.buyerSnapshot).toMatchObject({ name: 'Familie Berger', city: 'Köln' });
    expect(issued.body.sellerSnapshot).toMatchObject({ taxNumber: '214/5678/1234' });
  });

  it('die ausgestellte Rechnung als PDF enthält die Pflichtangaben', async () => {
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { number: R(1) } });
    const pdf = await fetchPdfText(app, `/invoices/${invoice.id}/pdf`, company.token);
    expect(pdf).toMatchObject({ status: 200, isPdf: true });
    expect(pdf.contentType).toContain('application/pdf');
    for (const expected of [
      `Abschlagsrechnung ${R(1)}`,
      'Familie Berger',
      'Lindenweg 3',
      'Gartenstraße 1',
      'Steuernummer 214/5678/1234',
      'Leistungsdatum',
      '372,60 €',
      'Umsatzsteuer 19 %',
      '443,39 €',
    ]) {
      expect(pdf.text).toContain(expected);
    }
    expect(pdf.text).not.toContain('ENTWURF');
  });

  it('Abschläge dürfen die Auftragssumme nicht übersteigen', async () => {
    await draft({ kind: 'partial', percent: 80 }).expect(400);
  });

  it('die Schlussrechnung zieht ausgestellte Abschläge ab', async () => {
    const final = await draft({ kind: 'final' }).expect(201);
    const deduction = final.body.lineItems.find((li: any) =>
      li.description.startsWith('abzüglich Abschlagsrechnung'),
    );
    expect(deduction.description).toContain(R(1));
    expect(Number(deduction.lineTotal)).toBe(-372.6);
    expect(Number(final.body.totalNet)).toBe(869.4); // 1.242,00 - 372,60

    const issued = await issue(final.body.id).expect(201);
    expect(issued.body.number).toBe(R(2));
    await draft({ kind: 'final' }).expect(400); // nur eine Schlussrechnung
  });

  it('ausgestellte Rechnungen sind unveränderlich – auch direkt in der Datenbank', async () => {
    const issued = await prisma.invoice.findFirstOrThrow({
      where: { number: R(1) },
      include: { lineItems: true },
    });
    await api().delete(`/invoices/${issued.id}`).set(auth).expect(400);
    await expect(prisma.invoice.update({ where: { id: issued.id }, data: { totalNet: 1 } })).rejects.toThrow(
      /unveränderlich/,
    );
    await expect(prisma.invoice.delete({ where: { id: issued.id } })).rejects.toThrow(/nicht gelöscht/);
    await expect(
      prisma.invoiceLineItem.update({
        where: { id: issued.lineItems[0].id },
        data: { description: 'geändert' },
      }),
    ).rejects.toThrow(/unveränderlich/);
  });

  it('Storno erzeugt eine Stornorechnung mit eigener Nummer und hebt das Original auf', async () => {
    const final = await prisma.invoice.findFirstOrThrow({ where: { number: R(2) } });
    await api().post(`/invoices/${final.id}/cancel`).set(auth).send({}).expect(400); // Begründung fehlt
    const cancellation = await api()
      .post(`/invoices/${final.id}/cancel`)
      .set(auth)
      .send({ reason: 'Falsche Menge abgerechnet' })
      .expect(201);
    expect(cancellation.body).toMatchObject({
      kind: 'cancellation',
      status: 'issued',
      number: R(3),
      cancelsInvoiceId: final.id,
    });
    expect(Number(cancellation.body.totalGross)).toBe(-Number(final.totalGross));

    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: final.id } })).status).toBe('cancelled');
    await api().post(`/invoices/${final.id}/cancel`).set(auth).send({ reason: 'nochmal' }).expect(400);

    // Nach dem Storno kann neu abgerechnet werden
    const again = await draft({ kind: 'final' }).expect(201);
    expect(Number(again.body.totalNet)).toBe(869.4);
  });

  it('ein Entwurf als PDF ist deutlich als Entwurf gekennzeichnet', async () => {
    const open = await prisma.invoice.findFirstOrThrow({ where: { status: 'draft' } });
    const pdf = await fetchPdfText(app, `/invoices/${open.id}/pdf`, company.token);
    expect(pdf.text).toContain('ENTWURF – keine gültige Rechnung');
  });

  it('Entwürfe lassen sich löschen, ohne eine Nummer zu verbrauchen', async () => {
    const open = await prisma.invoice.findFirstOrThrow({ where: { status: 'draft' } });
    await api().delete(`/invoices/${open.id}`).set(auth).expect(200);
    const next = await draft({ kind: 'final' }).expect(201);
    expect((await issue(next.body.id).expect(201)).body.number).toBe(R(4));
  });

  it('gleichzeitig: Abschläge über 100 % und doppelte Nummern sind ausgeschlossen', async () => {
    // Die Schlussrechnung R-0004 stornieren, damit wieder Abschläge möglich sind
    const final = await prisma.invoice.findFirstOrThrow({ where: { number: R(4) } });
    await api().post(`/invoices/${final.id}/cancel`).set(auth).send({ reason: 'Neu abrechnen' }).expect(201);

    // Bisher 30 % abgerechnet: zweimal gleichzeitig 60 % darf nur einmal gehen
    const partials = await Promise.all([
      draft({ kind: 'partial', percent: 60 }),
      draft({ kind: 'partial', percent: 60 }),
    ]);
    expect(partials.map((r) => r.status).sort()).toEqual([201, 400]);

    // Zwei Entwürfe gleichzeitig ausstellen: zwei verschiedene, fortlaufende Nummern
    const small = await draft({ kind: 'partial', percent: 5 }).expect(201);
    const created = partials.find((r) => r.status === 201)!;
    const issued = await Promise.all([issue(created.body.id), issue(small.body.id)]);
    expect(issued.map((r) => r.status)).toEqual([201, 201]);
    expect(issued.map((r) => r.body.number).sort()).toEqual([R(6), R(7)]);
  });

  const xrechnung = (id: string, token = company.token) =>
    api()
      .get(`/invoices/${id}/xrechnung`)
      .set({ Authorization: `Bearer ${token}` })
      .buffer(true)
      .parse((res, done) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
        res.on('end', () => done(null, body));
      });

  it('E-Rechnung: fehlende Kontakt- und Bankdaten werden benannt', async () => {
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { number: R(1) } });
    const res = await xrechnung(invoice.id).expect(400);
    const message = JSON.parse(res.body).message;
    for (const field of ['E-Mail der Firma', 'Telefon der Firma', 'IBAN der Firma', 'E-Mail des Kunden']) {
      expect(message).toContain(field);
    }
    const open = await draft({ kind: 'partial', percent: 1 }).expect(201);
    expect(JSON.parse((await xrechnung(open.body.id).expect(400)).body).message).toContain('ausgestellte');
    await api().delete(`/invoices/${open.body.id}`).set(auth).expect(200);
  });

  it('E-Rechnung (XRechnung 3.0, CII) für Abschlag, Schlussrechnung und Storno', async () => {
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({ email: 'info@rechnung.example', phone: '+49 221 12345', iban: 'de89 3704 0044 0532 0130 00' })
      .expect(200);
    await api().patch(`/customers/${customerId}`).set(auth).send({ email: 'berger@example.com' }).expect(200);

    const byNumber = (n: number) => prisma.invoice.findFirstOrThrow({ where: { number: R(n) } });
    const partial = await xrechnung((await byNumber(1)).id).expect(200);
    expect(partial.headers['content-type']).toContain('application/xml');
    expect(partial.headers['content-disposition']).toContain(`${R(1)}.xml`);
    for (const expected of [
      'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
      `<ram:ID>${R(1)}</ram:ID>`,
      '<ram:TypeCode>326</ram:TypeCode>',
      '<ram:IBANID>DE89370400440532013000</ram:IBANID>',
      '<ram:URIID schemeID="EM">berger@example.com</ram:URIID>',
      '<ram:ID schemeID="FC">214/5678/1234</ram:ID>',
      '<ram:BuyerReference>Terrasse</ram:BuyerReference>',
      '<ram:GrandTotalAmount>443.39</ram:GrandTotalAmount>',
    ]) {
      expect(partial.body).toContain(expected);
    }

    const final = await xrechnung((await byNumber(2)).id).expect(200);
    expect(final.body).toContain('<ram:TypeCode>380</ram:TypeCode>');
    expect(final.body).toContain('<ram:BilledQuantity unitCode="LS">-1.00</ram:BilledQuantity>');
    expect(final.body).toContain('<ram:ChargeAmount>372.60</ram:ChargeAmount>');

    const cancellation = await xrechnung((await byNumber(3)).id).expect(200);
    expect(cancellation.body).toContain('<ram:TypeCode>381</ram:TypeCode>');
    expect(cancellation.body).toContain(`<ram:IssuerAssignedID>${R(2)}</ram:IssuerAssignedID>`);
    expect(cancellation.body).not.toMatch(/<ram:GrandTotalAmount>-/);

    // Mit XRECHNUNG_OUT=<Verzeichnis> für den KoSIT-Validator speichern
    if (process.env.XRECHNUNG_OUT) {
      mkdirSync(process.env.XRECHNUNG_OUT, { recursive: true });
      for (const [name, res] of Object.entries({ partial, final, cancellation })) {
        writeFileSync(join(process.env.XRECHNUNG_OUT, `int-${name}.xml`), res.body);
      }
    }
  });

  it('andere Firmen sehen und bearbeiten keine fremden Rechnungen', async () => {
    const other = await createCompany(app, prisma, 'Fremd Rechnung GmbH');
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { number: R(4) } });
    const as = { Authorization: `Bearer ${other.token}` };
    await api().get(`/invoices/${invoice.id}`).set(as).expect(404);
    expect((await fetchPdfText(app, `/invoices/${invoice.id}/pdf`, other.token)).status).toBe(404);
    await api().post(`/invoices/${invoice.id}/cancel`).set(as).send({ reason: 'Übernahme' }).expect(404);
    await xrechnung(invoice.id, other.token).expect(404);
    await api().post('/invoices/from-order').set(as).send({ orderId, kind: 'final' }).expect(404);
    const list = await api().get(`/invoices/by-project/${projectId}`).set(as).expect(200);
    expect(list.body).toEqual([]);
  });
});
