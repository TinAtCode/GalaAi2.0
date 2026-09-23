import { INestApplication } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { BOOKKEEPING_PERMISSIONS, PermissionKey } from '../../src/common/permissions';
import { localDayString } from '../../src/common/time-zone';
import { camtFixture } from '../fixtures/camt/fixture';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

// Finanzbereich: Kontostände, Kontobewegungen, offene Forderungen, Monate.
describe('Finanzbereich', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  let invoice: { id: string; number: string; totalGross: string };
  const api = () => request(app.getHttpServer());
  const today = localDayString(new Date(), 'Europe/Berlin');
  const month = today.slice(0, 7);

  // Nutzer mit genau diesen Rechten, angemeldet
  async function userWith(keys: PermissionKey[], email: string) {
    const role = await prisma.role.create({
      data: {
        companyId: company.companyId,
        name: email,
        permissions: { create: keys.map((key) => ({ permission: { connect: { key } } })) },
      },
    });
    await prisma.user.create({
      data: {
        companyId: company.companyId,
        email,
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: 'T',
        lastName: 'T',
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api().post('/auth/login').send({ email, password: 'test12345' }).expect(201);
    return { Authorization: `Bearer ${login.body.accessToken}` };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Finanz GmbH');
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
        lineItems: [{ description: 'Teich anlegen', unit: 'psch', quantity: 1, unitPrice: 1000 }],
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
    invoice = (await api().post(`/invoices/${draft.body.id}/issue`).set(auth).send({}).expect(201)).body;

    // Kontoauszug (Stand 22.09.2026, Saldo 15.230,45 €) und zwei Bewegungen im laufenden Monat
    await api()
      .post('/bank/import')
      .set(auth)
      .attach('file', Buffer.from(camtFixture('08')), 'auszug.xml')
      .expect(201);
    const tx = (
      dedupeKey: string,
      direction: 'credit' | 'debit',
      amount: string,
      name: string,
      remittance: string,
    ) => ({
      companyId: company.companyId,
      dedupeKey,
      direction,
      bookingDate: new Date(`${today}T00:00:00Z`),
      amount: new Prisma.Decimal(amount),
      counterpartyName: name,
      remittance,
    });
    await prisma.bankTransaction.createMany({
      data: [
        tx('now-1', 'credit', '300.00', 'Familie Birke', 'Abschlag'),
        tx('now-2', 'debit', '120.50', 'Aral Tankstelle', 'Diesel Radlader'),
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('Übersicht: Kontostand, offene Forderungen und laufender Monat', async () => {
    const res = await api().get('/finance/overview').set(auth).expect(200);
    const body = res.body;
    expect(body.accounts).toEqual([
      { iban: 'DE89370400440532013000', balance: '15230.45', date: '2026-09-22' },
    ]);
    expect(Number(body.totalBalance)).toBe(15230.45);
    expect(body.transactionsUntil >= today).toBe(true);
    // neu ausgestellte Rechnung: offen, noch nicht fällig, in 14 Tagen fällig
    expect(body.receivables).toMatchObject({ count: 1 });
    expect(Number(body.receivables.open)).toBe(Number(invoice.totalGross));
    expect(Number(body.receivables.overdue)).toBe(0);
    expect(Number(body.receivables.dueNext30Days)).toBe(Number(invoice.totalGross));

    expect(body.months).toHaveLength(12);
    const current = body.months[11];
    expect(current.month).toBe(month);
    expect(Number(current.invoiced)).toBe(Number(invoice.totalGross));
    // Monatssummen aus den Kontobewegungen des laufenden Monats
    const inMonth = await prisma.bankTransaction.findMany({
      where: { companyId: company.companyId, bookingDate: { gte: new Date(`${month}-01T00:00:00Z`) } },
    });
    const total = (d: string) =>
      inMonth.filter((t) => t.direction === d).reduce((sum, t) => sum + Number(t.amount), 0);
    expect(Number(current.received)).toBeCloseTo(total('credit'));
    expect(Number(current.spent)).toBeCloseTo(total('debit'));
    expect(total('debit')).toBeGreaterThanOrEqual(120.5);
  });

  it('Kontobewegungen: Richtung, Suche, Zeitraum, seitenweise', async () => {
    const debits = await api().get('/finance/transactions?direction=debit').set(auth).expect(200);
    expect(debits.body.every((t: { direction: string }) => t.direction === 'debit')).toBe(true);
    expect(debits.body.map((t: { counterpartyName: string }) => t.counterpartyName)).toEqual(
      expect.arrayContaining(['Aral Tankstelle', 'Mobilfunk AG']),
    );

    const search = await api().get('/finance/transactions?q=radlader').set(auth).expect(200);
    expect(search.body.map((t: { remittance: string }) => t.remittance)).toEqual(['Diesel Radlader']);

    const range = await api()
      .get('/finance/transactions?from=2026-09-22&to=2026-09-22')
      .set(auth)
      .expect(200);
    expect(range.body.every((t: { bookingDate: string }) => t.bookingDate === '2026-09-22')).toBe(true);

    const page = await api().get('/finance/transactions?take=2').set(auth).expect(200);
    expect(page.body).toHaveLength(2);
    expect(Number(page.headers['x-total-count'])).toBe(await prisma.bankTransaction.count());
    // neueste zuerst
    expect(page.body[0].bookingDate >= page.body[1].bookingDate).toBe(true);

    await api().get('/finance/transactions?from=2026-02-30').set(auth).expect(400);
    await api().get('/finance/transactions?direction=sideways').set(auth).expect(400);
  });

  it('nur mit dem Recht finance.read: Buchhaltung ja, Mitarbeiter nein', async () => {
    const bookkeeping = await userWith(BOOKKEEPING_PERMISSIONS, 'buchhaltung@finanz.test');
    await api().get('/finance/overview').set(bookkeeping).expect(200);
    await api().get('/finance/transactions').set(bookkeeping).expect(200);
    // Buchhaltung verwaltet keine Nutzer
    await api().get('/users').set(bookkeeping).expect(403);

    const staff = await userWith(['customer.read'], 'mitarbeiter@finanz.test');
    await api().get('/finance/overview').set(staff).expect(403);
    await api().get('/finance/transactions').set(staff).expect(403);
  });

  it('Mandantentrennung: eine andere Firma sieht nichts davon', async () => {
    const other = await createCompany(app, prisma, 'Fremd Finanz GmbH');
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    const overview = await api().get('/finance/overview').set(otherAuth).expect(200);
    expect(overview.body).toMatchObject({ accounts: [], transactionsUntil: null, receivables: { count: 0 } });
    expect(overview.body.months.every((m: { spent: string }) => Number(m.spent) === 0)).toBe(true);
    expect((await api().get('/finance/transactions').set(otherAuth).expect(200)).body).toEqual([]);
  });
});
