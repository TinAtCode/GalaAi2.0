import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { sentForTests } from '../../src/mail/mail.service';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

// Rechnung per E-Mail: PDF und E-Rechnung (XML) im Anhang, an die Adresse
// des Kunden oder eine angegebene, protokolliert im Audit-Log.
describe('Rechnung per E-Mail senden', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  let customerId: string;
  let invoiceId: string;
  let draftId: string;
  const api = () => request(app.getHttpServer());
  const send = (id: string, body: object = {}) => api().post(`/invoices/${id}/send`).set(auth).send(body);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Versand GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({
        street: 'Gartenstraße 1',
        postalCode: '50667',
        city: 'Köln',
        taxNumber: '214/5678/1234',
        email: 'info@versand.example',
        phone: '+49 221 1',
        iban: 'DE89370400440532013000',
      })
      .expect(200);
    const customer = await api()
      .post('/customers')
      .set(auth)
      .send({
        name: 'Familie Rose',
        street: 'Weg 2',
        postalCode: '50667',
        city: 'Köln',
        email: 'rose@example.com',
      })
      .expect(201);
    customerId = customer.body.id;
    const property = await api().post('/properties').set(auth).send({ customerId, label: 'Garten' });
    const project = await api()
      .post('/projects')
      .set(auth)
      .send({ propertyId: property.body.id, title: 'Rosenbeet' });
    const service = await api().post('/services').set(auth).send({ name: 'Beet anlegen', unit: 'm2' });
    await api().post(`/services/${service.body.id}/components`).set(auth).send({ laborMinutes: 30 });
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({ projectId: project.body.id, lineItems: [{ serviceId: service.body.id, quantity: 10 }] })
      .expect(201);
    await api().post(`/quotes/${quote.body.id}/approve`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/send`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/outcome`).set(auth).send({ status: 'accepted' }).expect(201);
    const order = await api().post('/orders').set(auth).send({ quoteId: quote.body.id }).expect(201);
    const partial = await api()
      .post('/invoices/from-order')
      .set(auth)
      .send({ orderId: order.body.id, kind: 'partial', percent: 50 })
      .expect(201);
    invoiceId = (await api().post(`/invoices/${partial.body.id}/issue`).set(auth).send({}).expect(201)).body
      .id;
    const draft = await api()
      .post('/invoices/from-order')
      .set(auth)
      .send({ orderId: order.body.id, kind: 'partial', percent: 10 })
      .expect(201);
    draftId = draft.body.id;
  });

  afterAll(async () => {
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
    await app.close();
  });

  it('ohne eingerichteten Versand: klare Meldung', async () => {
    const res = await send(invoiceId).expect(400);
    expect(res.body.message).toContain('nicht eingerichtet');
  });

  it('sendet PDF und E-Rechnung an die Adresse des Kunden und protokolliert es', async () => {
    process.env.SMTP_URL = 'test';
    process.env.MAIL_FROM = 'Versand GmbH <rechnung@versand.example>';
    sentForTests.length = 0;

    const res = await send(invoiceId).expect(201);
    expect(res.body).toMatchObject({ sent: true, to: 'rose@example.com' });

    expect(sentForTests).toHaveLength(1);
    const [mail] = sentForTests;
    expect(mail).toMatchObject({
      to: 'rose@example.com',
      from: 'Versand GmbH <rechnung@versand.example>',
      replyTo: 'info@versand.example',
    });
    expect(mail.subject).toMatch(/^Abschlagsrechnung R-\d{4}-\d{4} – Versand GmbH$/);
    expect(String(mail.text)).toContain('Rosenbeet');
    const attachments = mail.attachments as { filename: string; content: Buffer; contentType: string }[];
    expect(attachments.map((a) => a.contentType)).toEqual(['application/pdf', 'application/xml']);
    expect(attachments[0].content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(attachments[1].content.toString()).toContain('urn:xeinkauf.de:kosit:xrechnung_3.0');

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'invoice_send', entityId: invoiceId },
    });
    expect(log).toMatchObject({ userId: company.userId, newData: { to: 'rose@example.com' } });
  });

  it('an eine andere Adresse, auf Wunsch nur als PDF', async () => {
    sentForTests.length = 0;
    await send(invoiceId, { to: 'buchhaltung@example.com', withXRechnung: false, message: 'Hallo' }).expect(
      201,
    );
    expect(sentForTests[0]).toMatchObject({ to: 'buchhaltung@example.com', text: 'Hallo' });
    expect((sentForTests[0].attachments as unknown[]).length).toBe(1);
  });

  it('Entwürfe nicht; ohne Adresse eine klare Meldung; fremde Firmen 404', async () => {
    await send(draftId).expect(400);
    await api().patch(`/customers/${customerId}`).set(auth).send({ email: '' }).expect(400);
    await prisma.customer.update({ where: { id: customerId }, data: { email: null } });
    const res = await send(invoiceId).expect(400);
    expect(res.body.message).toContain('Keine Empfängeradresse');

    const other = await createCompany(app, prisma, 'Fremd Versand GmbH');
    await api()
      .post(`/invoices/${invoiceId}/send`)
      .set({ Authorization: `Bearer ${other.token}` })
      .send({ to: 'x@example.com' })
      .expect(404);
  });
});
