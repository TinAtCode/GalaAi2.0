import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';
import { camtFixture } from '../fixtures/camt/fixture';

type Tx = {
  id: string;
  amount: string;
  remittance: string | null;
  debtorName: string | null;
  status: string;
  booked: string;
  rest: string;
  payments: { id: string; amount: string; invoiceId: string; number: string }[];
  suggestion: { invoiceId: string; number: string; reason: 'reference' | 'amount' } | null;
};

// Bankabgleich: Kontoauszug einlesen, Umsätze den Rechnungen zuordnen, buchen.
describe('Bankabgleich (CAMT.053)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let other: TestCompany;
  let auth: { Authorization: string };
  let orderId: string;
  let first: { id: string; number: string };
  let second: { id: string; number: string };
  const api = () => request(app.getHttpServer());
  const upload = (xml: string, as = auth) =>
    api().post('/bank/import').set(as).attach('file', Buffer.from(xml), 'auszug.xml');
  const list = async (status = 'open', as = auth) =>
    (await api().get(`/bank/transactions?status=${status}`).set(as).expect(200)).body as Tx[];
  const openOf = async (invoiceId: string) => {
    const items = (await api().get('/open-items').set(auth).expect(200)).body;
    const item = items.find((i: { invoiceId: string }) => i.invoiceId === invoiceId);
    return item ? Number(item.open) : 0;
  };

  async function issuedPartial(percent: number) {
    const draft = await api()
      .post('/invoices/from-order')
      .set(auth)
      .send({ orderId, kind: 'partial', percent })
      .expect(201);
    return (await api().post(`/invoices/${draft.body.id}/issue`).set(auth).send({}).expect(201)).body;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Bank GmbH');
    other = await createCompany(app, prisma, 'Fremd GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({ street: 'Weg 1', postalCode: '50667', city: 'Köln', taxNumber: '214/5678/1234' })
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
    first = await issuedPartial(30); // 3.570 brutto
    second = await issuedPartial(20); // 2.380 brutto
  });

  afterAll(async () => {
    await app.close();
  });

  it('liest Gutschriften ein, überspringt Duplikate und schlägt Rechnungen per Nummer vor', async () => {
    const xml = camtFixture('08', {
      NUMBER1: first.number,
      AMOUNT1: '1000.00',
      NUMBER2_COMPACT: second.number.replace(/-/g, ''),
      AMOUNT2: '2380.00',
    });
    const res = await upload(xml).expect(201);
    // 3 Zahlungseingänge + 1 Abbuchung, dazu der Schlusssaldo
    expect(res.body).toEqual({
      imported: 4,
      credits: 3,
      debits: 1,
      duplicates: 0,
      balances: 1,
      payablesPaid: 0,
      skipped: { notBooked: 1, foreignCurrency: 0 },
    });
    // derselbe Auszug noch einmal: nichts doppelt
    expect((await upload(xml).expect(201)).body).toMatchObject({ imported: 0, duplicates: 4 });

    // im Bankabgleich nur Zahlungseingänge, keine Abbuchungen
    const open = await list();
    expect(open).toHaveLength(3);
    const debit = await prisma.bankTransaction.findFirstOrThrow({ where: { direction: 'debit' } });
    expect(debit).toMatchObject({ counterpartyName: 'Mobilfunk AG' });
    await api().post(`/bank/transactions/${debit.id}/ignore`).set(auth).expect(404);
    await api()
      .post(`/bank/transactions/${debit.id}/book`)
      .set(auth)
      .send({ invoiceId: first.id })
      .expect(404);
    // Rückbuchung (z.B. zurückgekommene eigene Überweisung) ist kein Zahlungseingang
    const reversal = await prisma.bankTransaction.create({
      data: {
        companyId: company.companyId,
        dedupeKey: 'reversal-1',
        direction: 'credit',
        reversal: true,
        bookingDate: new Date('2026-09-22T00:00:00Z'),
        amount: 49.9,
        remittance: `Rückbuchung ${first.number}`,
      },
    });
    expect((await list()).map((t) => t.id)).not.toContain(reversal.id);
    await api()
      .post(`/bank/transactions/${reversal.id}/book`)
      .set(auth)
      .send({ invoiceId: first.id })
      .expect(404);
    await prisma.bankTransaction.delete({ where: { id: reversal.id } });
    const byAmount = (amount: number) => open.find((t) => Number(t.amount) === amount)!;
    expect(byAmount(1000).suggestion).toMatchObject({ invoiceId: first.id, reason: 'reference' });
    expect(byAmount(2380).suggestion).toMatchObject({ invoiceId: second.id, reason: 'reference' });
    expect(byAmount(75).suggestion).toBeNull();
  });

  it('bucht einen Umsatz als Zahlung zur Rechnung – genau einmal', async () => {
    const tx = (await list()).find((t) => Number(t.amount) === 1000)!;
    const res = await api()
      .post(`/bank/transactions/${tx.id}/book`)
      .set(auth)
      .send({ invoiceId: first.id })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'booked' });
    expect(await openOf(first.id)).toBe(2570);
    const payment = await prisma.invoicePayment.findUniqueOrThrow({ where: { id: res.body.paymentId } });
    expect(payment).toMatchObject({ method: 'bank', invoiceId: first.id, bankTransactionId: tx.id });
    expect(payment.paidOn.toISOString().slice(0, 10)).toBe('2026-09-22');
    expect(payment.note).toContain('Familie Birke');

    await api().post(`/bank/transactions/${tx.id}/book`).set(auth).send({ invoiceId: first.id }).expect(409);
    const booked = await list('booked');
    expect(booked.map((t) => t.id)).toEqual([tx.id]);
    expect(booked[0].payments).toEqual([
      expect.objectContaining({ id: res.body.paymentId, number: first.number }),
    ]);
  });

  it('schlägt ohne Nummer nur bei eindeutigem Restbetrag vor', async () => {
    // 2.570 € offen hat nur die erste Rechnung
    await upload(camtFixture('02', { NUMBER1: 'Teich', AMOUNT1: '2570.00' })).expect(201);
    const tx = (await list()).find((t) => Number(t.amount) === 2570)!;
    expect(tx.suggestion).toMatchObject({ invoiceId: first.id, reason: 'amount' });
  });

  it('prüft Betrag und Rechnung; bei Fehler bleibt der Umsatz offen', async () => {
    const tx = (await list()).find((t) => Number(t.amount) === 2380)!;
    // höher als der Bankumsatz
    await api()
      .post(`/bank/transactions/${tx.id}/book`)
      .set(auth)
      .send({ invoiceId: second.id, amount: 2380.01 })
      .expect(400);
    // unbekannte Rechnung: 404, der Umsatz bleibt offen
    const small = (await list()).find((t) => Number(t.amount) === 75)!;
    await api()
      .post(`/bank/transactions/${small.id}/book`)
      .set(auth)
      .send({ invoiceId: '00000000-0000-0000-0000-000000000000' })
      .expect(404);
    expect((await list()).map((t) => t.id)).toContain(small.id);
    expect(await prisma.invoicePayment.count({ where: { bankTransactionId: { not: null } } })).toBe(1);
  });

  it('ein Umsatz begleicht mehrere Rechnungen; gebucht erst, wenn alles verteilt ist', async () => {
    const tx = (await list()).find((t) => Number(t.amount) === 2380)!;
    const part = await api()
      .post(`/bank/transactions/${tx.id}/book`)
      .set(auth)
      .send({ invoiceId: second.id, amount: 2000 })
      .expect(201);
    expect(part.body).toMatchObject({ status: 'open' });
    expect(Number(part.body.rest)).toBe(380);
    expect(await openOf(second.id)).toBe(380);

    const still = (await list()).find((t) => t.id === tx.id)!;
    expect([Number(still.booked), Number(still.rest)]).toEqual([2000, 380]);
    // die schon bezahlte Rechnung wird nicht erneut vorgeschlagen
    expect(still.suggestion).toBeNull();
    const tooMuch = await api()
      .post(`/bank/transactions/${tx.id}/book`)
      .set(auth)
      .send({ invoiceId: first.id, amount: 380.01 })
      .expect(400);
    expect(tooMuch.body.message).toContain('380,00 €');

    // ohne Betrag: der Rest
    const rest = await api()
      .post(`/bank/transactions/${tx.id}/book`)
      .set(auth)
      .send({ invoiceId: first.id })
      .expect(201);
    expect(rest.body).toMatchObject({ status: 'booked' });
    expect(await openOf(first.id)).toBe(2190);
    const booked = (await list('booked')).find((t) => t.id === tx.id)!;
    expect(booked.payments.map((p) => [p.number, Number(p.amount)])).toEqual([
      [second.number, 2000],
      [first.number, 380],
    ]);
  });

  it('Zahlung löschen öffnet den Bankumsatz wieder', async () => {
    const tx = (await list('booked')).find((t) => Number(t.amount) === 2380)!;
    const payment = tx.payments.find((p) => p.invoiceId === second.id)!;
    await api().delete(`/invoices/${second.id}/payments/${payment.id}`).set(auth).expect(200);
    const reopened = (await list()).find((t) => t.id === tx.id)!;
    expect(reopened.status).toBe('open');
    expect([Number(reopened.booked), Number(reopened.rest)]).toEqual([380, 2000]);
    expect(await openOf(second.id)).toBe(2380);
  });

  it('ignorieren und wieder öffnen; gebuchte Umsätze lassen sich nicht ignorieren', async () => {
    const small = (await list()).find((t) => Number(t.amount) === 75)!;
    await api().post(`/bank/transactions/${small.id}/ignore`).set(auth).expect(200);
    expect((await list('ignored')).map((t) => t.id)).toEqual([small.id]);
    await api().post(`/bank/transactions/${small.id}/ignore`).set(auth).expect(400);
    await api().post(`/bank/transactions/${small.id}/reopen`).set(auth).expect(200);
    expect((await list()).map((t) => t.id)).toContain(small.id);

    // Rest eines teilweise gebuchten Umsatzes ignorieren (z.B. Überzahlung)
    const partial = (await list()).find((t) => Number(t.amount) === 2380)!;
    await api().post(`/bank/transactions/${partial.id}/ignore`).set(auth).expect(200);
    await api()
      .post(`/bank/transactions/${partial.id}/book`)
      .set(auth)
      .send({ invoiceId: second.id })
      .expect(409);
    await api().post(`/bank/transactions/${partial.id}/reopen`).set(auth).expect(200);

    const [booked] = await list('booked');
    await api().post(`/bank/transactions/${booked.id}/ignore`).set(auth).expect(400);
  });

  it('gleichzeitige Teilbuchungen verteilen nie mehr als den Umsatz', async () => {
    // 2.570 € Umsatz, drei gleichzeitige Buchungen zu je 1.000 € auf eine
    // Rechnung mit 2.190 € offen: zwei passen, die dritte übersteigt den Rest
    const tx = (await list()).find((t) => Number(t.amount) === 2570)!;
    const results = await Promise.all(
      [0, 1, 2].map(() =>
        api().post(`/bank/transactions/${tx.id}/book`).set(auth).send({ invoiceId: first.id, amount: 1000 }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 400]);
    expect(await prisma.invoicePayment.count({ where: { bankTransactionId: tx.id } })).toBe(2);
    expect(await openOf(first.id)).toBe(190);
  });

  it('Mandantentrennung: fremde Firma sieht und bucht keine Umsätze', async () => {
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    expect(await list('open', otherAuth)).toEqual([]);
    const tx = (await list())[0];
    await api()
      .post(`/bank/transactions/${tx.id}/book`)
      .set(otherAuth)
      .send({ invoiceId: first.id })
      .expect(404);
    await api().post(`/bank/transactions/${tx.id}/ignore`).set(otherAuth).expect(404);
    // derselbe Auszug bei der anderen Firma ist kein Duplikat, aber ohne Vorschlag
    const xml = camtFixture('08', { NUMBER1: first.number });
    expect((await upload(xml, otherAuth).expect(201)).body.imported).toBe(4);
    const foreign = await list('open', otherAuth);
    expect(foreign.every((t) => t.suggestion === null)).toBe(true);
    // eigenen Umsatz auf eine Rechnung der anderen Firma buchen: nicht gefunden
    await api()
      .post(`/bank/transactions/${foreign[0].id}/book`)
      .set(otherAuth)
      .send({ invoiceId: first.id })
      .expect(404);
  });

  it('MT940 und CSV: gleiche Vorschläge, Duplikate erkannt; unbekannte Dateien abgelehnt', async () => {
    const invoice = await issuedPartial(10);
    const gross = Number(invoice.totalGross).toFixed(2).replace('.', ',');
    const mt940 = [
      ':20:STARTUMSE',
      ':25:DE89370400440532013000',
      ':60F:C260921EUR0,00',
      `:61:2609240924CR${gross}NTRFNONREF`,
      `:86:166?00GUTSCHRIFT?20SVWZ+Zahlung ${invoice.number}?31DE02120300000000202051?32Familie MT`,
      `:62F:C260924EUR${gross}`,
      '-',
    ].join('\r\n');
    const imported = (await upload(mt940).expect(201)).body;
    expect(imported).toMatchObject({ imported: 1, credits: 1, duplicates: 0, balances: 1 });
    expect((await upload(mt940).expect(201)).body).toMatchObject({ imported: 0, duplicates: 1 });
    const tx = (await list()).find((t) => t.debtorName === 'Familie MT')!;
    expect(tx.suggestion).toMatchObject({ invoiceId: invoice.id, reason: 'reference' });

    // derselbe Umsatz als CSV aus einem anderen Export: neuer Umsatz (anderes Format)
    const csv = [
      'Auftragskonto;Buchungstag;Verwendungszweck;Beguenstigter/Zahlungspflichtiger;Kontonummer/IBAN;Betrag;Waehrung',
      `DE89370400440532013000;24.09.2026;Rest ${invoice.number};Familie CSV;DE02120300000000202051;1,00;EUR`,
    ].join('\n');
    expect((await upload(csv).expect(201)).body).toMatchObject({ imported: 1, credits: 1 });
    expect((await list()).find((t) => t.debtorName === 'Familie CSV')?.suggestion).toMatchObject({
      invoiceId: invoice.id,
    });

    const res = await upload('Das ist kein Kontoauszug').expect(400);
    expect(res.body.message).toMatch(/Buchungstag|Betrag/);
    await api().post('/bank/import').set(auth).expect(400);
  });
});
