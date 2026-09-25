import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as iconv from 'iconv-lite';
import request from 'supertest';
import { DEBTOR_COLUMNS, EXTF_COLUMNS } from '../../src/datev/extf-columns';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';
import { localDayString } from '../../src/common/time-zone';

// DATEV-Buchungsstapel (EXTF) der Ausgangsrechnungen für den Steuerberater.
describe('DATEV-Export', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  let customerId: string;
  const api = () => request(app.getHttpServer());
  // "heute" in der Zeitzone der Firma (wie die App), nicht in UTC – sonst
  // schlagen die Tests zwischen Mitternacht Berlin und Mitternacht UTC fehl
  const today = localDayString(new Date(), 'Europe/Berlin');
  const year = Number(today.slice(0, 4));
  const range = `from=${year}-01-01&to=${year}-12-31`;

  const download = (query: string, token = company.token) =>
    api()
      .get(`/datev/bookings?${query}`)
      .set({ Authorization: `Bearer ${token}` })
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
  const lines = (body: Buffer) => iconv.decode(body, 'win1252').split('\r\n').filter(Boolean);
  const fields = (line: string) => line.split(';');
  const col = (row: string[], name: (typeof EXTF_COLUMNS)[number]) => row[EXTF_COLUMNS.indexOf(name)];

  async function issuedInvoices(vatRate?: number) {
    const property = await api().post('/properties').set(auth).send({ customerId, label: 'Garten' });
    const project = await api()
      .post('/projects')
      .set(auth)
      .send({ propertyId: property.body.id, title: 'Hecke' });
    const service = await api().post('/services').set(auth).send({ name: 'Hecke schneiden', unit: 'm' });
    await api().post(`/services/${service.body.id}/components`).set(auth).send({ laborMinutes: 12 });
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({
        projectId: project.body.id,
        lineItems: [{ serviceId: service.body.id, quantity: 50 }],
        ...(vatRate !== undefined ? { vatRate } : {}),
      })
      .expect(201);
    await api().post(`/quotes/${quote.body.id}/approve`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/send`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/outcome`).set(auth).send({ status: 'accepted' }).expect(201);
    const order = await api().post('/orders').set(auth).send({ quoteId: quote.body.id }).expect(201);
    const partial = await api()
      .post('/invoices/from-order')
      .set(auth)
      .send({ orderId: order.body.id, kind: 'partial', percent: 40 })
      .expect(201);
    const partialIssued = (
      await api().post(`/invoices/${partial.body.id}/issue`).set(auth).send({}).expect(201)
    ).body;
    const final = await api()
      .post('/invoices/from-order')
      .set(auth)
      .send({ orderId: order.body.id, kind: 'final' })
      .expect(201);
    const finalIssued = (await api().post(`/invoices/${final.body.id}/issue`).set(auth).send({}).expect(201))
      .body;
    return { partialIssued, finalIssued };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Buchhaltung GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({ street: 'Gartenstraße 1', postalCode: '50667', city: 'Köln', taxNumber: '214/5678/1234' })
      .expect(200);
    const customer = await api()
      .post('/customers')
      .set(auth)
      .send({ name: 'Familie Müller & Söhne', street: 'Weg 2', postalCode: '50667', city: 'Köln' })
      .expect(201);
    customerId = customer.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('Kunden bekommen fortlaufende Debitorennummern ab 10000, von Hand änderbar, ohne Dubletten', async () => {
    const first = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(first.debtorNumber).toBe(10000);
    const second = await api().post('/customers').set(auth).send({ name: 'Zweiter Kunde' }).expect(201);
    expect(second.body.debtorNumber).toBe(10001);
    await api().patch(`/customers/${second.body.id}`).set(auth).send({ debtorNumber: 10005 }).expect(200);
    const conflict = await api()
      .patch(`/customers/${second.body.id}`)
      .set(auth)
      .send({ debtorNumber: 10000 })
      .expect(409);
    expect(conflict.body.message).toContain('Debitorennummer');
    await api().patch(`/customers/${second.body.id}`).set(auth).send({ debtorNumber: 999 }).expect(400);
    // Nummern, die von Hand vergeben wurden, überspringt der Zähler
    await prisma.numberSequence.update({
      where: { companyId_kind_year: { companyId: company.companyId, kind: 'debtor', year: 0 } },
      data: { lastValue: 5 }, // nächster Wert wäre 10005
    });
    const third = await api().post('/customers').set(auth).send({ name: 'Dritter Kunde' }).expect(201);
    expect(third.body.debtorNumber).toBe(10006);
  });

  it('ohne Berater- und Mandantennummer: klare Meldung', async () => {
    const res = await download(range).expect(400);
    expect(res.body.toString()).toContain('Berater- und Mandantennummer');
  });

  it('Buchungsstapel: Kopfzeile, 124 Spalten, Debitor an Erlöskonto, Storno im Haben', async () => {
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({ datevConsultantNumber: 29098, datevClientNumber: 55003 })
      .expect(200);
    const { partialIssued, finalIssued } = await issuedInvoices();
    await api().post(`/invoices/${finalIssued.id}/cancel`).set(auth).send({ reason: 'Fehler' }).expect(201);

    const res = await download(range).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(`EXTF_Buchungsstapel_${year}0101_${year}1231.csv`);
    const [header, columns, ...rows] = lines(res.body);

    const h = fields(header);
    expect(h).toHaveLength(31);
    expect(h.slice(0, 5)).toEqual(['"EXTF"', '700', '21', '"Buchungsstapel"', '12']);
    expect(h[10]).toBe('29098');
    expect(h[11]).toBe('55003');
    expect(h[12]).toBe(`${year}0101`);
    expect(h[13]).toBe('4');
    expect(h[14]).toBe(`${year}0101`);
    expect(h[15]).toBe(`${year}1231`);
    expect(h[26]).toBe('"03"');

    expect(fields(columns)).toHaveLength(124);
    expect(rows).toHaveLength(3); // Abschlag, Schluss, Storno
    for (const row of rows) expect(fields(row)).toHaveLength(124);

    const [partialRow, finalRow, cancelRow] = rows.map(fields);
    const money = (d: string) => d.replace('.', ',');
    expect(col(partialRow, 'Umsatz')).toBe(money(Number(partialIssued.totalGross).toFixed(2)));
    expect(col(partialRow, 'Soll-/Haben-Kennzeichen')).toBe('"S"');
    expect(col(partialRow, 'Konto')).toBe('10000');
    expect(col(partialRow, 'Gegenkonto (ohne BU-Schlüssel)')).toBe('8400');
    expect(col(partialRow, 'Belegfeld 1')).toBe(`"${partialIssued.number}"`);
    expect(col(partialRow, 'Belegdatum')).toMatch(/^\d{4}$/);
    expect(col(partialRow, 'Buchungstext')).toBe('"Abschlagsrechnung Familie Müller & Söhne"');
    expect(col(partialRow, 'BU-Schlüssel')).toBe('""');
    expect(col(partialRow, 'Festschreibung')).toBe('0');
    expect(col(partialRow, 'Fälligkeit')).toMatch(/^\d{8}$/);

    expect(col(finalRow, 'Umsatz')).toBe(money(Number(finalIssued.totalGross).toFixed(2)));
    expect(col(cancelRow, 'Soll-/Haben-Kennzeichen')).toBe('"H"');
    expect(col(cancelRow, 'Umsatz')).toBe(col(finalRow, 'Umsatz'));
    expect(col(cancelRow, 'Buchungstext')).toMatch(/^"Stornorechnung /);

    // Umlaute in Windows-1252, nicht UTF-8
    expect(res.body.includes(Buffer.from('Müller', 'utf8'))).toBe(false);
    expect(res.body.includes(iconv.encode('Müller', 'win1252'))).toBe(true);

    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'datev_export' } });
    expect(log).toMatchObject({ userId: company.userId, newData: { count: 3 } });
  });

  it('7 %, SKR04 und eigene Erlöskonten', async () => {
    await issuedInvoices(7);
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({ datevChartOfAccounts: 'SKR04', datevRevenueAccounts: { standard19: 4401 } })
      .expect(200);
    const rows = lines((await download(range).expect(200)).body)
      .slice(2)
      .map(fields);
    const accounts = rows.map((r) => col(r, 'Gegenkonto (ohne BU-Schlüssel)'));
    expect(accounts).toEqual(['4401', '4401', '4401', '4300', '4300']);
    const settings = await api().get('/company/settings').set(auth).expect(200);
    expect(settings.body).toMatchObject({
      datevChartOfAccounts: 'SKR04',
      datevRevenueAccounts: { standard19: 4401 },
    });
  });

  it('Zeitraum prüfen: Format, Reihenfolge, ein Wirtschaftsjahr, leerer Zeitraum', async () => {
    await download('from=gestern&to=heute').expect(400);
    await download(`from=${year}-12-31&to=${year}-01-01`).expect(400);
    const twoYears = await download(`from=${year - 1}-12-01&to=${year}-01-31`).expect(400);
    expect(twoYears.body.toString()).toContain('Wirtschaftsjahr');
    const empty = await download(`from=${year - 1}-01-01&to=${year - 1}-12-31`).expect(400);
    expect(empty.body.toString()).toContain('keine ausgestellten Rechnungen');
    await download(`from=${today}&to=${today}`).expect(200);
  });

  it('Zahlungseingänge nur auf Wunsch: Geldkonto an Debitor, Belegfeld = Rechnungsnummer', async () => {
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({ datevChartOfAccounts: 'SKR03', datevRevenueAccounts: {} })
      .expect(200);
    const { partialIssued } = await issuedInvoices();
    const pay = (amount: number, method: string) =>
      api()
        .post(`/invoices/${partialIssued.id}/payments`)
        .set(auth)
        .send({ amount, paidOn: today, method })
        .expect(201);
    await pay(100, 'bank');
    await pay(20.5, 'cash');
    await pay(5, 'other');

    const without = lines((await download(range).expect(200)).body)
      .slice(2)
      .map(fields);
    expect(without.some((r) => col(r, 'Buchungstext').startsWith('"Zahlung '))).toBe(false);

    const res = await download(`${range}&payments=1`).expect(200);
    const [header, , ...rows] = lines(res.body);
    expect(fields(header)[16]).toBe(`"Rechnungen+Zahlungen 01/${year}"`);
    const paymentRows = rows.map(fields).filter((r) => col(r, 'Buchungstext').startsWith('"Zahlung '));
    expect(paymentRows).toHaveLength(3);
    const [bank, cash, other] = paymentRows;
    expect(col(bank, 'Umsatz')).toBe('100,00');
    expect(col(bank, 'Soll-/Haben-Kennzeichen')).toBe('"S"');
    expect(col(bank, 'Konto')).toBe('1200');
    expect(col(bank, 'Gegenkonto (ohne BU-Schlüssel)')).toBe('10000');
    expect(col(bank, 'Belegfeld 1')).toBe(`"${partialIssued.number}"`);
    expect(col(bank, 'Belegdatum')).toBe(`${today.slice(8, 10)}${today.slice(5, 7)}`);
    expect(col(cash, 'Konto')).toBe('1000');
    expect(col(cash, 'Umsatz')).toBe('20,50');
    // sonstige Zahlungen auf Geldtransit, nicht auf die Bank
    expect(col(other, 'Konto')).toBe('1360');

    // SKR04 und eigene Geldkonten
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({ datevChartOfAccounts: 'SKR04', datevRevenueAccounts: { bank: 1810 } })
      .expect(200);
    const skr04 = lines((await download(`${range}&payments=1`).expect(200)).body)
      .slice(2)
      .map(fields)
      .filter((r) => col(r, 'Buchungstext').startsWith('"Zahlung '))
      .map((r) => col(r, 'Konto'));
    expect(skr04).toEqual(['1810', '1600', '1460']);
  });

  it('Kunden ohne Debitorennummer bekommen beim Export genau eine, auch bei gleichzeitigen Exporten', async () => {
    await prisma.customer.update({ where: { id: customerId }, data: { debtorNumber: null } });
    const results = await Promise.all([download(range), download(range), download(range)]);
    const numbers = new Set(
      results.map((res) => {
        expect(res.status).toBe(200);
        return col(fields(lines(res.body)[2]), 'Konto');
      }),
    );
    const stored = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(stored.debtorNumber).not.toBeNull();
    expect([...numbers]).toEqual([String(stored.debtorNumber)]);
  });

  it('andere Firmen exportieren nur ihre eigenen Rechnungen; ohne Recht 403', async () => {
    const other = await createCompany(app, prisma, 'Fremd Buchhaltung GmbH');
    await prisma.company.update({
      where: { id: other.companyId },
      data: { datevConsultantNumber: 1001, datevClientNumber: 1 },
    });
    const res = await download(range, other.token).expect(400);
    expect(res.body.toString()).toContain('keine ausgestellten Rechnungen');

    await prisma.rolePermission.deleteMany({
      where: { permission: { key: 'data.export' }, role: { companyId: other.companyId } },
    });
    await download(range, other.token).expect(403);
  });

  it('Debitoren-Stammdaten: Kopfzeile, Name, Anschrift, USt-IdNr.; fehlende Nummern werden vergeben', async () => {
    const firma = await api()
      .post('/customers')
      .set(auth)
      .send({
        name: 'Wohnbau Rhein GmbH',
        isBusiness: true,
        vatId: 'DE 123456789',
        email: 'buero@wohnbau.de',
      })
      .expect(201);
    await prisma.customer.update({ where: { id: firma.body.id }, data: { debtorNumber: null } });
    const get = (query = '') =>
      api()
        .get(`/datev/debtors${query}`)
        .set(auth)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
    const res = await get().expect(200);
    expect(res.headers['content-disposition']).toContain('EXTF_Debitoren.csv');
    const [head, columns, ...rows] = lines(res.body);
    expect(head).toMatch(/^"EXTF";700;16;"Debitoren\/Kreditoren";5;\d{17};;"RE";"GartenAI";"";\d+;\d+;/);
    expect(fields(columns)).toHaveLength(DEBTOR_COLUMNS.length);
    const cell = (row: string[], name: (typeof DEBTOR_COLUMNS)[number]) => row[DEBTOR_COLUMNS.indexOf(name)];
    const byName = (name: string) => rows.map(fields).find((r) => r.join(';').includes(name))!;

    const mueller = byName('Müller');
    const muellerStored = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(cell(mueller, 'Konto')).toBe(String(muellerStored.debtorNumber));
    expect(cell(mueller, 'Name (Adressattyp keine Angabe)')).toBe('"Familie Müller & Söhne"');
    expect(cell(mueller, 'Adressattyp')).toBe('0');
    expect(cell(mueller, 'Straße')).toBe('"Weg 2"');
    expect(cell(mueller, 'Ort')).toBe('"Köln"');
    expect(mueller).toHaveLength(DEBTOR_COLUMNS.length);

    const wohnbau = byName('Wohnbau');
    expect(cell(wohnbau, 'Name (Adressattyp Unternehmen)')).toBe('"Wohnbau Rhein GmbH"');
    expect(cell(wohnbau, 'Adressattyp')).toBe('2');
    expect(cell(wohnbau, 'EU-Land')).toBe('"DE"');
    expect(cell(wohnbau, 'EU-UStID')).toBe('"123456789"');
    expect(cell(wohnbau, 'E-Mail')).toBe('"buero@wohnbau.de"');
    // die fehlende Nummer ist jetzt vergeben und steht in der Datei
    const stored = await prisma.customer.findUniqueOrThrow({ where: { id: firma.body.id } });
    expect(stored.debtorNumber).toBeGreaterThanOrEqual(10000);
    expect(cell(wohnbau, 'Konto')).toBe(String(stored.debtorNumber));
    // nach Kontonummer sortiert
    const accounts = rows.map((r) => Number(fields(r)[0]));
    expect([...accounts].sort((a, b) => a - b)).toEqual(accounts);

    // ohne eigene Anschrift: die des Objekts
    const ohne = await api().post('/customers').set(auth).send({ name: 'Ohne Anschrift' }).expect(201);
    await api()
      .post('/properties')
      .set(auth)
      .send({
        customerId: ohne.body.id,
        label: 'Garten',
        street: 'Lindenweg 3',
        postalCode: '53111',
        city: 'Bonn',
      })
      .expect(201);
    const again = lines((await get().expect(200)).body)
      .slice(2)
      .map(fields);
    const row = again.find((r) => r.join(';').includes('Ohne Anschrift'))!;
    expect(cell(row, 'Straße')).toBe('"Lindenweg 3"');
    expect(cell(row, 'Ort')).toBe('"Bonn"');

    // nur Kunden mit Rechnungen
    const invoiced = lines((await get('?invoiced=1').expect(200)).body).slice(2);
    expect(invoiced.some((r) => r.includes('Müller'))).toBe(true);
    expect(invoiced.some((r) => r.includes('Wohnbau'))).toBe(false);
  });
});
