import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { localDayString } from '../../src/common/time-zone';
import { addMonths } from '../../src/finance/recurring';
import { camtFixture } from '../fixtures/camt/fixture';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

type Category = { id: string; name: string; transactions: number; rules: { id: string; pattern: string }[] };
type Tx = {
  id: string;
  counterpartyName: string;
  category: { id: string; name: string } | null;
  categorySource: string | null;
};

// Kategorien (Regeln, Lernen aus Zuordnungen), wiederkehrende Zahlungen,
// Jahresüberblick
describe('Finanzen: Kategorien, Fixkosten, Jahresüberblick', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  const api = () => request(app.getHttpServer());
  const today = localDayString(new Date(), 'Europe/Berlin');
  const categories = async () =>
    (await api().get('/finance/categories').set(auth).expect(200)).body as Category[];
  const byName = async (name: string) => (await categories()).find((c) => c.name === name)!;
  const transactions = async (query = '') =>
    (await api().get(`/finance/transactions?direction=debit${query}`).set(auth).expect(200)).body as Tx[];
  const debit = (
    key: string,
    bookingDate: string,
    amount: number,
    name: string,
    iban: string | null = null,
    remittance = '',
  ) => ({
    companyId: company.companyId,
    dedupeKey: key,
    direction: 'debit' as const,
    bookingDate: new Date(`${bookingDate}T00:00:00Z`),
    amount: new Prisma.Decimal(amount),
    counterpartyName: name,
    counterpartyIban: iban,
    remittance,
  });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Kategorie GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
  });

  afterAll(async () => {
    await app.close();
  });

  it('Startkategorien und -regeln für neue Firmen; Import ordnet per Regel zu', async () => {
    const list = await categories();
    expect(list.map((c) => c.name)).toEqual([
      'Material',
      'Fahrzeuge',
      'Maschinen',
      'Miete',
      'Personal',
      'Versicherungen',
      'Büro',
      'Steuern',
      'Sonstiges',
    ]);
    expect(list.find((c) => c.name === 'Fahrzeuge')!.rules.map((r) => r.pattern)).toContain('aral');

    // Kontoauszug: Abbuchung "Mobilfunk AG" trifft keine Regel
    await api()
      .post('/bank/import')
      .set(auth)
      .attach('file', Buffer.from(camtFixture('08')), 'auszug.xml')
      .expect(201);
    await prisma.bankTransaction.createMany({
      data: [
        debit('d-1', '2026-09-10', 89.9, 'ARAL Station 4711'),
        debit('d-2', '2026-09-11', 412.5, 'Baustoffe Müller KG', null, 'Kartenzahlung Baustoff'),
      ],
    });
    expect((await api().post('/finance/transactions/categorize').set(auth).expect(201)).body).toEqual({
      assigned: 2,
    });
    const tx = await transactions();
    const cat = (name: string) => tx.find((t) => t.counterpartyName === name)!;
    expect(cat('ARAL Station 4711')).toMatchObject({
      category: { name: 'Fahrzeuge' },
      categorySource: 'rule',
    });
    expect(cat('Baustoffe Müller KG')).toMatchObject({
      category: { name: 'Material' },
      categorySource: 'rule',
    });
    expect(cat('Mobilfunk AG').category).toBeNull();
    expect((await transactions('&category=none')).map((t) => t.counterpartyName)).toEqual(['Mobilfunk AG']);
  });

  it('Zuordnung von Hand lernt: gleicher Empfänger später automatisch; optional als Regel', async () => {
    const office = await byName('Büro');
    const mobile = (await transactions()).find((t) => t.counterpartyName === 'Mobilfunk AG')!;
    const res = await api()
      .patch(`/finance/transactions/${mobile.id}`)
      .set(auth)
      .send({ categoryId: office.id })
      .expect(200);
    expect(res.body.categoryId).toBe(office.id);

    // nächster Monat: gleicher Empfänger kommt per Import dazu -> gelernt
    const next = camtFixture('08')
      .replace(/REF-0003/g, 'REF-0103')
      .replace(/REF-000([124])/g, 'REF-010$1');
    await api().post('/bank/import').set(auth).attach('file', Buffer.from(next), 'auszug2.xml').expect(201);
    const learned = (await transactions()).filter((t) => t.counterpartyName === 'Mobilfunk AG');
    expect(learned).toHaveLength(2);
    expect(learned.map((t) => [t.category?.name, t.categorySource]).sort()).toEqual([
      ['Büro', 'learned'],
      ['Büro', 'manual'],
    ]);

    // mit Regel: Empfänger als Stichwort gespeichert
    const machines = await byName('Maschinen');
    await prisma.bankTransaction.create({ data: debit('d-3', '2026-09-12', 120, 'Maschinenmiete Süd GmbH') });
    await api().post('/finance/transactions/categorize').set(auth).expect(201);
    const park = (await transactions()).find((t) => t.counterpartyName === 'Maschinenmiete Süd GmbH')!;
    // Stichwort "miete" hätte "Miete" gewählt – von Hand korrigieren und merken
    expect(park.category?.name).toBe('Miete');
    await api()
      .patch(`/finance/transactions/${park.id}`)
      .set(auth)
      .send({ categoryId: machines.id, createRule: true })
      .expect(200);
    expect((await byName('Maschinen')).rules.map((r) => r.pattern)).toContain('maschinenmiete süd gmbh');

    // bewusst ohne Kategorie: bleibt so, auch nach erneutem Zuordnen
    await api().patch(`/finance/transactions/${park.id}`).set(auth).send({ categoryId: null }).expect(200);
    await api().post('/finance/transactions/categorize').set(auth).expect(201);
    expect((await transactions()).find((t) => t.id === park.id)!.category).toBeNull();
  });

  it('Kategorien anlegen, umbenennen, löschen (Umsätze verlieren nur die Kategorie)', async () => {
    const created = await api()
      .post('/finance/categories')
      .set(auth)
      .send({ name: 'Entsorgung' })
      .expect(201);
    await api().post('/finance/categories').set(auth).send({ name: 'Entsorgung' }).expect(409);
    await api()
      .post(`/finance/categories/${created.body.id}/rules`)
      .set(auth)
      .send({ pattern: 'Deponie' })
      .expect(201);
    await prisma.bankTransaction.create({ data: debit('d-4', '2026-09-13', 230, 'Deponie Nord') });
    await api().post('/finance/transactions/categorize').set(auth).expect(201);
    const dump = (await transactions()).find((t) => t.counterpartyName === 'Deponie Nord')!;
    expect(dump.category?.name).toBe('Entsorgung');
    await api()
      .patch(`/finance/categories/${created.body.id}`)
      .set(auth)
      .send({ name: 'Entsorgung & Deponie' })
      .expect(200);
    await api().delete(`/finance/categories/${created.body.id}`).set(auth).expect(200);
    // wieder offen und neu zugeordnet, wo etwas passt – hier nichts
    expect((await transactions()).find((t) => t.id === dump.id)).toMatchObject({
      category: null,
      categorySource: null,
    });
    expect(await prisma.categoryRule.count({ where: { pattern: 'deponie' } })).toBe(0);
  });

  it('wiederkehrende Zahlungen: erkennen, übernehmen, im Jahresüberblick planen', async () => {
    // Leasing monatlich die letzten vier Monate
    const iban = 'DE44500105175407324931';
    const dates = [4, 3, 2, 1].map((m) => addMonths(`${today.slice(0, 7)}-03`, -m));
    await prisma.bankTransaction.createMany({
      data: dates.map((d, i) => debit(`lease-${i}`, d, 640, 'Leasing GmbH', iban, 'Leasing Radlader')),
    });
    const suggestions = (await api().get('/finance/recurring/suggestions').set(auth).expect(200)).body;
    const lease = suggestions.find((s: { name: string }) => s.name === 'Leasing GmbH');
    expect(lease).toMatchObject({ interval: 'monthly', occurrences: 4, nextDue: addMonths(dates[3], 1) });

    const vehicles = await byName('Fahrzeuge');
    const created = await api()
      .post('/finance/recurring')
      .set(auth)
      .send({
        name: 'Leasing Radlader',
        counterpartyName: 'Leasing GmbH',
        counterpartyIban: iban,
        amount: 640,
        interval: 'monthly',
        nextDue: lease.nextDue,
        categoryId: vehicles.id,
      })
      .expect(201);
    // angelegt: kein Vorschlag mehr
    const again = (await api().get('/finance/recurring/suggestions').set(auth).expect(200)).body;
    expect(again.find((s: { name: string }) => s.name === 'Leasing GmbH')).toBeUndefined();
    await api().post('/finance/recurring').set(auth).send({ name: 'Unvollständig' }).expect(400);

    // Jahresüberblick: künftige Fälligkeiten geplant, bereits abgebuchte nicht
    const year = Number(today.slice(0, 4));
    const overview = (await api().get(`/finance/year?year=${year}`).set(auth).expect(200)).body;
    expect(overview.months).toHaveLength(12);
    expect(Number(overview.fixedCostsPerMonth)).toBe(640);
    const plannedMonths = overview.months
      .filter((m: { planned: unknown[] }) => m.planned.length > 0)
      .map((m: { month: string }) => m.month);
    const expected = [];
    for (let d = lease.nextDue; d <= `${year}-12-31`; d = addMonths(d, 1))
      if (d >= today) expected.push(d.slice(0, 7));
    expect(plannedMonths).toEqual(expected);
    // vergangene Monate: Ausgaben je Kategorie aus dem Kontoauszug
    const pastMonth = overview.months.find((m: { month: string }) => m.month === dates[3].slice(0, 7));
    if (pastMonth) expect(Number(pastMonth.spent)).toBeGreaterThanOrEqual(640);

    // pausieren: nicht mehr geplant
    await api().patch(`/finance/recurring/${created.body.id}`).set(auth).send({ active: false }).expect(200);
    const paused = (await api().get(`/finance/year?year=${year}`).set(auth).expect(200)).body;
    expect(paused.months.every((m: { planned: unknown[] }) => m.planned.length === 0)).toBe(true);
    await api().delete(`/finance/recurring/${created.body.id}`).set(auth).expect(200);
    await api().get('/finance/year?year=abc').set(auth).expect(400);
  });

  it('Startwerte nur einmal: auch gleichzeitig, und gelöschte kommen nicht wieder', async () => {
    const fresh = await createCompany(app, prisma, 'Startwerte GmbH');
    const freshAuth = { Authorization: `Bearer ${fresh.token}` };
    await Promise.all([1, 2, 3].map(() => api().get('/finance/categories').set(freshAuth).expect(200)));
    expect(await prisma.expenseCategory.count({ where: { companyId: fresh.companyId } })).toBe(9);
    expect(await prisma.categoryRule.count({ where: { companyId: fresh.companyId } })).toBe(26);
    const list = (await api().get('/finance/categories').set(freshAuth).expect(200)).body as Category[];
    for (const c of list) await api().delete(`/finance/categories/${c.id}`).set(freshAuth).expect(200);
    expect((await api().get('/finance/categories').set(freshAuth).expect(200)).body).toEqual([]);
  });

  it('Fixkosten ohne Empfänger: Abbuchung mit der Bezeichnung als Name zählt als bezahlt', async () => {
    const year = Number(today.slice(0, 4));
    const due = `${today.slice(0, 7)}-28`;
    const created = await api()
      .post('/finance/recurring')
      .set(auth)
      .send({ name: 'Stadtwerke Nord', amount: 80, interval: 'monthly', nextDue: due })
      .expect(201);
    const month = () =>
      api()
        .get(`/finance/year?year=${year}`)
        .set(auth)
        .expect(200)
        .then((r) => r.body.months.find((m: { month: string }) => m.month === today.slice(0, 7)));
    if (due >= today) expect((await month()).planned).toHaveLength(1);
    await prisma.bankTransaction.create({ data: debit('sw-1', today, 80, 'STADTWERKE NORD') });
    expect((await month()).planned).toHaveLength(0);
    await api().delete(`/finance/recurring/${created.body.id}`).set(auth).expect(200);
  });

  it('Mandantentrennung: fremde Kategorien, Umsätze und Fixkosten sind nicht erreichbar', async () => {
    const other = await createCompany(app, prisma, 'Fremd Kategorie GmbH');
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    const own = await byName('Büro');
    const foreignCats = (await api().get('/finance/categories').set(otherAuth).expect(200))
      .body as Category[];
    expect(foreignCats.find((c) => c.name === 'Büro')!.id).not.toBe(own.id);
    const tx = (await transactions())[0];
    await api().patch(`/finance/transactions/${tx.id}`).set(otherAuth).send({ categoryId: null }).expect(404);
    // eigener Umsatz, fremde Kategorie
    await prisma.bankTransaction.create({
      data: { ...debit('o-1', '2026-09-01', 10, 'X'), companyId: other.companyId },
    });
    const foreignTx = (await api().get('/finance/transactions').set(otherAuth).expect(200)).body[0];
    await api()
      .patch(`/finance/transactions/${foreignTx.id}`)
      .set(otherAuth)
      .send({ categoryId: own.id })
      .expect(404);
    await api().delete(`/finance/categories/${own.id}`).set(otherAuth).expect(404);
  });
});
