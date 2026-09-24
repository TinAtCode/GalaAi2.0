import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as iconv from 'iconv-lite';
import request from 'supertest';
import { sentForTests } from '../../src/mail/mail.service';
import { createApp, createCompany, fetchPdfText, resetDatabase, TestCompany } from './helpers';
import { EXTF_COLUMNS } from '../../src/datev/extf-columns';
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
    const payment = await api()
      .post(`/invoices/${invoice.id}/payments`)
      .set(auth)
      .send({ amount: 1, paidOn: localDayString(new Date(), 'Europe/Berlin') })
      .expect(201);
    expect((await send(second.id).expect(400)).body.message).toContain('Zahlung eingegangen');
    // mit Zahlung kein Storno – erst die Zahlung entfernen
    const blocked = await api().post(`/invoices/${invoice.id}/cancel`).set(auth).send({ reason: 'Kulanz' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toContain('Zahlungen zuerst entfernen');
    await api().delete(`/invoices/${invoice.id}/payments/${payment.body.id}`).set(auth).expect(200);
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

  it('optional: Mahngebühren, Verzugszinsen und Pauschale (Geschäftskunde), in Mahnung und offenen Posten', async () => {
    // Standard: aus
    const settings = (await api().get('/company/settings').set(auth).expect(200)).body;
    expect(settings).toMatchObject({ dunningInterest: false, dunningLumpSum: false, baseInterestRate: null });
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({
        dunningFee1: 2.5,
        dunningFee2: 5,
        dunningFee3: 7.5,
        dunningInterest: true,
        baseInterestRate: 1.27,
        dunningLumpSum: true,
      })
      .expect(200);
    await api().patch('/company/settings').set(auth).send({ baseInterestRate: 30 }).expect(400);
    await api().patch('/company/settings').set(auth).send({ dunningFee1: null }).expect(400);
    await api().patch('/company/settings').set(auth).send({ dunningInterest: null }).expect(400);
    const customer = await prisma.customer.findFirstOrThrow({
      where: { companyId: company.companyId, name: 'Familie Eiche' },
    });
    await api().patch(`/customers/${customer.id}`).set(auth).send({ isBusiness: true }).expect(200);

    const invoice = await issuedPartial(10); // 119 brutto
    await backdate(invoice.id, 60);
    const item = await openItem(invoice.id);
    // Geschäftskunde: Verzug 30 Tage nach Fälligkeit, Zinsen bis heute (einschließlich)
    const today = localDayString(new Date(), 'Europe/Berlin');
    const from = addCalendarDays(item.dueDate, 31);
    const days = (Date.parse(today) - Date.parse(from)) / 86_400_000 + 1;
    const expected = Math.round(((119 * 10.27) / 100) * (days / 365) * 100) / 100;

    const first = (await dun(invoice.id).expect(201)).body;
    expect(first).toMatchObject({ fee: '2.5', lumpSum: '40', interestRate: '10.27' });
    expect(Number(first.interest)).toBeCloseTo(expected, 2);
    expect(first.interestFrom.slice(0, 10)).toBe(from);

    await expire(invoice.id);
    const second = (await dun(invoice.id).expect(201)).body;
    expect(second).toMatchObject({ fee: '5', lumpSum: '0' });
    const pdf = await fetchPdfText(app, `/invoices/${invoice.id}/dunning/${second.id}/pdf`, company.token);
    for (const text of [
      'Offener Rechnungsbetrag',
      'Mahngebühren',
      '7,50 €',
      'Verzugszinsen 10,27 % p. a.',
      'Verzugspauschale',
      '40,00 €',
      'Zu zahlen',
    ]) {
      expect(pdf.text).toContain(text);
    }
    const entries = (await openItem(invoice.id)).dunning;
    expect(entries.map((d: { fee: string; lumpSum: string }) => [d.fee, d.lumpSum])).toEqual([
      ['2.5', '40'],
      ['5', '0'],
    ]);

    // wieder aus: neue Mahnungen ohne Zusatzforderungen
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({
        dunningFee1: 0,
        dunningFee2: 0,
        dunningFee3: 0,
        dunningInterest: false,
        dunningLumpSum: false,
        baseInterestRate: null,
      })
      .expect(200);
    await api().patch(`/customers/${customer.id}`).set(auth).send({ isBusiness: false }).expect(200);
  });

  it('Zahlungen auf Mahnkosten und Zinsen (§ 367 BGB), nur auf den Rechnungsbetrag, Erlass, DATEV', async () => {
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({ dunningFee1: 5, datevConsultantNumber: 1001, datevClientNumber: 1 })
      .expect(200);
    const today = localDayString(new Date(), 'Europe/Berlin');
    const pay = (invoiceId: string, body: object) =>
      api()
        .post(`/invoices/${invoiceId}/payments`)
        .set(auth)
        .send({ paidOn: today, ...body });

    // 1) Kunde zahlt Rechnung plus Mahngebühr: erst die Gebühr, dann die Rechnung
    const full = await issuedPartial(10); // 119 brutto
    await backdate(full.id, 60);
    await dun(full.id).expect(201);
    let item = await openItem(full.id);
    expect(item).toMatchObject({ open: '119', totalOpen: '124' });
    expect(item.charges).toMatchObject({ costs: '5', open: '5' });
    const payment = (await pay(full.id, { amount: 124 }).expect(201)).body;
    expect(payment).toMatchObject({ amount: '124', costsAmount: '5', interestAmount: '0' });
    expect(await openItem(full.id)).toBeUndefined();
    // mehr als die offene Forderung geht nicht
    const tooMuch = await pay(full.id, { amount: 0.01 }).expect(400);
    expect(tooMuch.body.message).toContain('übersteigt');

    // 2) Kunde zahlt nur den Rechnungsbetrag: Gebühr bleibt offen, dann Erlass
    const principal = await issuedPartial(10);
    await backdate(principal.id, 60);
    await dun(principal.id).expect(201);
    // § 367: 119 ohne Bestimmung deckt erst die Gebühr, dann 114 der Rechnung
    const law = (await pay(principal.id, { amount: 119 }).expect(201)).body;
    expect(law).toMatchObject({ costsAmount: '5' });
    item = await openItem(principal.id);
    expect(item).toMatchObject({ open: '5', totalOpen: '5' });
    await api().delete(`/invoices/${principal.id}/payments/${law.id}`).set(auth).expect(200);
    // mit Bestimmung nur auf die Rechnung
    await pay(principal.id, { amount: 119, allocation: 'principal' }).expect(201);
    await pay(principal.id, { amount: 1, allocation: 'principal' }).expect(400);
    item = await openItem(principal.id);
    expect(item).toMatchObject({ open: '0', totalOpen: '5', nextDunningLevel: null });
    const invoices = (await api().get(`/invoices/by-project/${item.project.id}`).set(auth).expect(200)).body;
    expect(invoices.find((i: { id: string }) => i.id === principal.id).claims).toMatchObject({
      principalOpen: '0',
      chargesOpen: '5',
    });
    await api()
      .post(`/invoices/${principal.id}/charges/waive`)
      .set(auth)
      .send({ reason: 'Kulanz' })
      .expect(201);
    expect(await openItem(principal.id)).toBeUndefined();
    const again = await api().post(`/invoices/${principal.id}/charges/waive`).set(auth).send({}).expect(400);
    expect(again.body.message).toContain('keine Mahnkosten');
    expect(
      await prisma.auditLog.count({ where: { action: 'invoice_charges_waive', entityId: principal.id } }),
    ).toBe(1);

    // 3) DATEV: Anteil der Gebühr als Ertrag (SKR03 2700), der Rest an den Debitor
    const res = await api()
      .get(`/datev/bookings?from=${today}&to=${today}&payments=1`)
      .set(auth)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const rows = iconv
      .decode(res.body as Buffer, 'win1252')
      .split('\r\n')
      .slice(2)
      .filter(Boolean)
      .map((l) => l.split(';'));
    const col = (row: string[], name: (typeof EXTF_COLUMNS)[number]) => row[EXTF_COLUMNS.indexOf(name)];
    const fee = rows.filter((r) => col(r, 'Buchungstext').includes('Mahnkosten'));
    expect(fee).toHaveLength(1);
    expect(col(fee[0], 'Umsatz')).toBe('5,00');
    expect(col(fee[0], 'Gegenkonto (ohne BU-Schlüssel)')).toBe('2700');
    const payments = rows.filter((r) => col(r, 'Buchungstext').includes('Zahlung'));
    // Zahlung 124 € -> 119 € an den Debitor (+ 5 € Ertrag), Zahlung 119 € nur auf die Rechnung
    expect(payments.filter((r) => col(r, 'Umsatz') === '119,00')).toHaveLength(2);
    expect(payments.some((r) => col(r, 'Umsatz') === '124,00')).toBe(false);

    await api().patch('/company/settings').set(auth).send({ dunningFee1: 0 }).expect(200);
  });
});
