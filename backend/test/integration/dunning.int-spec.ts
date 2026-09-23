import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { sentForTests } from '../../src/mail/mail.service';
import { createApp, createCompany, fetchPdfText, resetDatabase, TestCompany } from './helpers';
import { addCalendarDays, localDayString } from '../../src/common/time-zone';

// Mahnwesen: Zahlungserinnerung, 1. und 2. Mahnung zu überfälligen Rechnungen.
describe('Mahnwesen', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  let orderId: string;
  const api = () => request(app.getHttpServer());
  const dun = (invoiceId: string, token = company.token) =>
    api()
      .post(`/invoices/${invoiceId}/dunning`)
      .set({ Authorization: `Bearer ${token}` })
      .send({});
  const openItem = async (invoiceId: string) =>
    (await api().get('/open-items').set(auth).expect(200)).body.find(
      (i: { invoiceId: string }) => i.invoiceId === invoiceId,
    );

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

  // Rechnungsdatum zurückdatieren (per API nicht möglich; Rechnungen sind unveränderlich)
  async function backdate(invoiceId: string, days: number) {
    await prisma.$executeRaw`ALTER TABLE "Invoice" DISABLE TRIGGER invoice_guard`;
    try {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { issueDate: new Date(Date.now() - days * 24 * 3600 * 1000) },
      });
    } finally {
      await prisma.$executeRaw`ALTER TABLE "Invoice" ENABLE TRIGGER invoice_guard`;
    }
  }

  // Frist der letzten Mahnung ablaufen lassen
  const expire = (invoiceId: string) =>
    prisma.dunningNotice.updateMany({
      where: { invoiceId },
      data: { deadline: new Date(Date.now() - 2 * 24 * 3600 * 1000) },
    });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Mahn GmbH');
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
        iban: 'DE89370400440532013000',
        email: 'info@mahn.example',
        dunningDeadlineDays: 10,
      })
      .expect(200);
    const customer = await api()
      .post('/customers')
      .set(auth)
      .send({
        name: 'Familie Eiche',
        street: 'Eichenweg 2',
        postalCode: '50667',
        city: 'Köln',
        email: 'eiche@example.com',
      })
      .expect(201);
    const property = await api()
      .post('/properties')
      .set(auth)
      .send({ customerId: customer.body.id, label: 'Garten' });
    const project = await api()
      .post('/projects')
      .set(auth)
      .send({ propertyId: property.body.id, title: 'Hecke' });
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({
        projectId: project.body.id,
        vatRate: 19,
        lineItems: [{ description: 'Hecke schneiden', unit: 'psch', quantity: 1, unitPrice: 1000 }],
      })
      .expect(201);
    await api().post(`/quotes/${quote.body.id}/approve`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/send`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/outcome`).set(auth).send({ status: 'accepted' }).expect(201);
    orderId = (await api().post('/orders').set(auth).send({ quoteId: quote.body.id }).expect(201)).body.id;
  });

  afterAll(async () => {
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
    await app.close();
  });

  it('erst nach Fälligkeit; drei Stufen, jede erst nach Ablauf der vorigen Frist', async () => {
    const invoice = await issuedPartial(20); // 200 netto, 238 brutto
    const early = await dun(invoice.id).expect(400);
    expect(early.body.message).toContain('noch nicht überfällig');

    await backdate(invoice.id, 20); // Zahlungsziel 14 Tage -> 6 Tage überfällig
    expect((await openItem(invoice.id)).nextDunningLevel).toBe(1);
    const first = await dun(invoice.id).expect(201);
    expect(first.body).toMatchObject({ level: 1 });
    expect(Number(first.body.openAmount)).toBe(238);
    // Frist = heute + 10 Tage (Firmeneinstellung)
    const expected = addCalendarDays(localDayString(new Date(), 'Europe/Berlin'), 10);
    expect(first.body.deadline.slice(0, 10)).toBe(expected);

    const running = await dun(invoice.id).expect(400);
    expect(running.body.message).toContain('Frist der Zahlungserinnerung läuft noch');
    let item = await openItem(invoice.id);
    expect(item.nextDunningLevel).toBeNull();
    expect(item.dunning.map((d: { level: number }) => d.level)).toEqual([1]);

    await expire(invoice.id);
    expect((await openItem(invoice.id)).nextDunningLevel).toBe(2);
    expect((await dun(invoice.id).expect(201)).body.level).toBe(2);
    await expire(invoice.id);
    expect((await dun(invoice.id).expect(201)).body.level).toBe(3);
    await expire(invoice.id);
    const max = await dun(invoice.id).expect(400);
    expect(max.body.message).toContain('letzte Mahnstufe');
    item = await openItem(invoice.id);
    expect(item.dunning.map((d: { level: number }) => d.level)).toEqual([1, 2, 3]);
    expect(item.nextDunningLevel).toBeNull();

    const audit = await prisma.auditLog.count({ where: { action: 'dunning_create', entityId: invoice.id } });
    expect(audit).toBe(3);
  });

  it('PDF je Stufe mit offenem Betrag, Frist und Bankverbindung; Teilzahlungen berücksichtigt', async () => {
    const invoice = await issuedPartial(10); // 119 brutto
    await backdate(invoice.id, 30);
    await api()
      .post(`/invoices/${invoice.id}/payments`)
      .set(auth)
      .send({ amount: 19, paidOn: localDayString(new Date(), 'Europe/Berlin') })
      .expect(201);
    const notice = (await dun(invoice.id).expect(201)).body;
    expect(Number(notice.openAmount)).toBe(100);

    const pdf = await fetchPdfText(app, `/invoices/${invoice.id}/dunning/${notice.id}/pdf`, company.token);
    expect(pdf).toMatchObject({ status: 200, isPdf: true });
    for (const expected of [
      'Zahlungserinnerung',
      'Familie Eiche',
      invoice.number,
      '119,00 €',
      '19,00 €',
      '100,00 €',
      'Zahlbar bis',
      'IBAN DE89370400440532013000',
      'Kundennummer',
      'Steuernummer 214/5678/1234',
    ]) {
      expect(pdf.text).toContain(expected);
    }
    await expire(invoice.id);
    const second = (await dun(invoice.id).expect(201)).body;
    const secondPdf = await fetchPdfText(
      app,
      `/invoices/${invoice.id}/dunning/${second.id}/pdf`,
      company.token,
    );
    expect(secondPdf.text).toContain('1. Mahnung');
    expect(secondPdf.text).toContain('trotz unserer Zahlungserinnerung vom');
  });

  it('Versand per E-Mail an den Kunden, mit PDF; im Audit-Log', async () => {
    process.env.SMTP_URL = 'test';
    process.env.MAIL_FROM = 'Mahn GmbH <rechnung@mahn.example>';
    sentForTests.length = 0;
    const invoice = await issuedPartial(5);
    await backdate(invoice.id, 20);
    const notice = (await dun(invoice.id).expect(201)).body;
    const res = await api()
      .post(`/invoices/${invoice.id}/dunning/${notice.id}/send`)
      .set(auth)
      .send({})
      .expect(201);
    expect(res.body).toMatchObject({ sent: true, to: 'eiche@example.com' });
    expect(sentForTests).toHaveLength(1);
    expect(sentForTests[0]).toMatchObject({
      to: 'eiche@example.com',
      replyTo: 'info@mahn.example',
      subject: `Zahlungserinnerung zu Rechnung ${invoice.number} – Mahn GmbH`,
    });
    const [attachment] = sentForTests[0].attachments as { filename: string; content: Buffer }[];
    expect(attachment.filename).toBe(`Zahlungserinnerung-${invoice.number}.pdf`);
    expect(attachment.content.subarray(0, 5).toString()).toBe('%PDF-');
    const stored = await prisma.dunningNotice.findUniqueOrThrow({ where: { id: notice.id } });
    expect(stored).toMatchObject({ sentTo: 'eiche@example.com' });
    expect(stored.sentAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'dunning_send', entityId: invoice.id } })).toBe(1);

    // Überholte Mahnungen gehen nicht mehr raus
    const send = (noticeId: string) =>
      api().post(`/invoices/${invoice.id}/dunning/${noticeId}/send`).set(auth).send({});
    await expire(invoice.id);
    expect((await send(notice.id).expect(400)).body.message).toContain('Frist dieser Mahnung ist abgelaufen');
    const second = (await dun(invoice.id).expect(201)).body;
    expect((await send(notice.id).expect(400)).body.message).toContain('höhere Mahnstufe');
    await send(second.id).expect(201);
    await api()
      .post(`/invoices/${invoice.id}/payments`)
      .set(auth)
      .send({ amount: 1, paidOn: localDayString(new Date(), 'Europe/Berlin') })
      .expect(201);
    expect((await send(second.id).expect(400)).body.message).toContain('Zahlung eingegangen');
    await api().post(`/invoices/${invoice.id}/cancel`).set(auth).send({ reason: 'Kulanz' }).expect(201);
    expect((await send(second.id).expect(400)).body.message).toContain('storniert');
    expect(sentForTests).toHaveLength(2);
  });

  it('keine Mahnung für bezahlte, stornierte und fremde Rechnungen; gleichzeitig nur eine Stufe', async () => {
    const paid = await issuedPartial(1);
    await backdate(paid.id, 20);
    await api()
      .post(`/invoices/${paid.id}/payments`)
      .set(auth)
      .send({ amount: Number(paid.totalGross), paidOn: localDayString(new Date(), 'Europe/Berlin') })
      .expect(201);
    expect((await dun(paid.id).expect(400)).body.message).toContain('bereits bezahlt');

    const cancelled = await issuedPartial(1);
    const storno = await api()
      .post(`/invoices/${cancelled.id}/cancel`)
      .set(auth)
      .send({ reason: 'Fehler' })
      .expect(201);
    await dun(cancelled.id).expect(400);
    await dun(storno.body.id).expect(400);

    const other = await createCompany(app, prisma, 'Fremd Mahn GmbH');
    const open = await issuedPartial(1);
    await backdate(open.id, 20);
    await dun(open.id, other.token).expect(404);

    const results = await Promise.all([dun(open.id), dun(open.id), dun(open.id)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.dunningNotice.count({ where: { invoiceId: open.id } })).toBe(1);
  });
});
