import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';
import { localDayString } from '../../src/common/time-zone';

// Zahlungseingänge und offene Posten. Die Rechnung selbst bleibt
// unverändert; offen ist der Bruttobetrag abzüglich der Zahlungen.
describe('Zahlungen und offene Posten', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  let orderId: string;
  const api = () => request(app.getHttpServer());
  // "heute" in der Zeitzone der Firma, wie die App rechnet
  const today = localDayString(new Date(), 'Europe/Berlin');
  const pay = (invoiceId: string, body: object) =>
    api().post(`/invoices/${invoiceId}/payments`).set(auth).send(body);

  async function issuedPartial(percent: number) {
    const draft = await api()
      .post('/invoices/from-order')
      .set(auth)
      .send({ orderId, kind: 'partial', percent })
      .expect(201);
    return (await api().post(`/invoices/${draft.body.id}/issue`).set(auth).send({}).expect(201)).body as {
      id: string;
      number: string;
      totalGross: string;
    };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Zahlung GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({
        street: 'Weg 1',
        postalCode: '50667',
        city: 'Köln',
        taxNumber: '214/5678/1234',
        paymentTermDays: 14,
      })
      .expect(200);
    const customer = await api()
      .post('/customers')
      .set(auth)
      .send({ name: 'Familie Birke', street: 'Birkenweg 4', postalCode: '50667', city: 'Köln' })
      .expect(201);
    const property = await api()
      .post('/properties')
      .set(auth)
      .send({ customerId: customer.body.id, label: 'Garten' });
    const project = await api()
      .post('/projects')
      .set(auth)
      .send({ propertyId: property.body.id, title: 'Teich' });
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({
        projectId: project.body.id,
        vatRate: 19,
        lineItems: [{ description: 'Teich anlegen', unit: 'psch', quantity: 1, unitPrice: 10000 }],
      })
      .expect(201);
    await api().post(`/quotes/${quote.body.id}/approve`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/send`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/outcome`).set(auth).send({ status: 'accepted' }).expect(201);
    orderId = (await api().post('/orders').set(auth).send({ quoteId: quote.body.id }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('Teilzahlungen bis zum Bruttobetrag, keine Überzahlung; offene Posten zeigen den Rest', async () => {
    const invoice = await issuedPartial(30); // 3.000 netto, 3.570 brutto
    expect(Number(invoice.totalGross)).toBe(3570);

    await pay(invoice.id, { amount: 1000, paidOn: today }).expect(201);
    let items = (await api().get('/open-items').set(auth).expect(200)).body;
    const item = items.find((i: { invoiceId: string }) => i.invoiceId === invoice.id);
    expect(item).toMatchObject({
      number: invoice.number,
      customer: { name: 'Familie Birke' },
      daysOverdue: 0,
    });
    expect(Number(item.paid)).toBe(1000);
    expect(Number(item.open)).toBe(2570);

    const tooMuch = await pay(invoice.id, { amount: 2570.01, paidOn: today }).expect(400);
    expect(tooMuch.body.message).toContain('2570,00 €');
    await pay(invoice.id, {
      amount: 2570,
      paidOn: today,
      method: 'cash',
      note: 'bar auf der Baustelle',
    }).expect(201);
    items = (await api().get('/open-items').set(auth).expect(200)).body;
    expect(items.find((i: { invoiceId: string }) => i.invoiceId === invoice.id)).toBeUndefined();

    // Die Rechnung selbst ist unverändert; die Zahlungen hängen an ihr
    const list = await api()
      .get(
        `/invoices/by-project/${(await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).projectId}`,
      )
      .set(auth)
      .expect(200);
    const listed = list.body.find((i: { id: string }) => i.id === invoice.id);
    expect(
      listed.payments.map((p: { amount: string; method: string }) => [Number(p.amount), p.method]),
    ).toEqual([
      [1000, 'bank'],
      [2570, 'cash'],
    ]);
    expect(listed.status).toBe('issued');

    const audit = await prisma.auditLog.findMany({
      where: { action: 'invoice_payment', entityId: invoice.id },
    });
    expect(audit).toHaveLength(2);
  });

  it('Korrektur: Zahlung löschen macht den Betrag wieder offen (mit Audit-Log)', async () => {
    const invoice = await issuedPartial(10);
    const payment = (await pay(invoice.id, { amount: 100, paidOn: today }).expect(201)).body;
    await api().delete(`/invoices/${invoice.id}/payments/${payment.id}`).set(auth).expect(200);
    await api().delete(`/invoices/${invoice.id}/payments/${payment.id}`).set(auth).expect(404);
    const item = (await api().get('/open-items').set(auth).expect(200)).body.find(
      (i: { invoiceId: string }) => i.invoiceId === invoice.id,
    );
    expect(Number(item.open)).toBe(Number(invoice.totalGross));
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'invoice_payment_delete' } });
    expect(log).toMatchObject({ entityId: invoice.id, oldData: { amount: 100, paidOn: today } });
  });

  it('gleichzeitige Zahlungen überschreiten den offenen Betrag nicht', async () => {
    const invoice = await issuedPartial(5); // 500 netto, 595 brutto
    const results = await Promise.all(
      Array.from({ length: 4 }, () => pay(invoice.id, { amount: 200, paidOn: today })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 400)).toHaveLength(2);
    const sum = await prisma.invoicePayment.aggregate({
      where: { invoiceId: invoice.id },
      _sum: { amount: true },
    });
    expect(Number(sum._sum.amount)).toBe(400);
  });

  it('überfällige Rechnungen: Tage im Verzug ab Fälligkeit (Rechnungsdatum + Zahlungsziel)', async () => {
    const invoice = await issuedPartial(5);
    // Rechnungsdatum 20 Tage zurück (direkt in der Datenbank; per API geht das nicht)
    await prisma.$executeRaw`ALTER TABLE "Invoice" DISABLE TRIGGER invoice_guard`;
    try {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { issueDate: new Date(Date.now() - 20 * 24 * 3600 * 1000) },
      });
    } finally {
      await prisma.$executeRaw`ALTER TABLE "Invoice" ENABLE TRIGGER invoice_guard`;
    }
    const items = (await api().get('/open-items').set(auth).expect(200)).body;
    const item = items.find((i: { invoiceId: string }) => i.invoiceId === invoice.id);
    expect(item.daysOverdue).toBe(6);
    expect(items[0].invoiceId).toBe(invoice.id); // älteste Fälligkeit zuerst
  });

  it('keine Zahlungen auf Entwürfe, Stornos und stornierte Rechnungen; fremde Firmen 404', async () => {
    const draft = await api()
      .post('/invoices/from-order')
      .set(auth)
      .send({ orderId, kind: 'partial', percent: 1 })
      .expect(201);
    await pay(draft.body.id, { amount: 1, paidOn: today }).expect(400);

    const invoice = await issuedPartial(1);
    const cancellation = await api()
      .post(`/invoices/${invoice.id}/cancel`)
      .set(auth)
      .send({ reason: 'Fehler' })
      .expect(201);
    await pay(invoice.id, { amount: 1, paidOn: today }).expect(400);
    await pay(cancellation.body.id, { amount: 1, paidOn: today }).expect(400);
    const openIds = (await api().get('/open-items').set(auth).expect(200)).body.map(
      (i: { invoiceId: string }) => i.invoiceId,
    );
    expect(openIds).not.toContain(invoice.id);
    expect(openIds).not.toContain(cancellation.body.id);

    await pay(draft.body.id, { amount: 0, paidOn: today }).expect(400);
    await pay(draft.body.id, { amount: 1, paidOn: 'gestern' }).expect(400);
    await pay(draft.body.id, { amount: 1, paidOn: '2026-13-01' }).expect(400);
    await pay(draft.body.id, { amount: 1, paidOn: '2026-02-30' }).expect(400);

    const other = await createCompany(app, prisma, 'Fremd Zahlung GmbH');
    const open = await issuedPartial(1);
    await api()
      .post(`/invoices/${open.id}/payments`)
      .set({ Authorization: `Bearer ${other.token}` })
      .send({ amount: 1, paidOn: today })
      .expect(404);
    expect(
      (
        await api()
          .get('/open-items')
          .set({ Authorization: `Bearer ${other.token}` })
          .expect(200)
      ).body,
    ).toEqual([]);
  });
});
