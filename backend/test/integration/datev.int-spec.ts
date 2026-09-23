import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as iconv from 'iconv-lite';
import request from 'supertest';
import { EXTF_COLUMNS } from '../../src/datev/extf-columns';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

// DATEV-Buchungsstapel (EXTF) der Ausgangsrechnungen für den Steuerberater.
describe('DATEV-Export', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  let customerId: string;
  const api = () => request(app.getHttpServer());
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
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
});
