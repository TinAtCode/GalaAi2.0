import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { EMPLOYEE_PERMISSIONS } from '../../src/common/permissions';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// Querverbindungen aus dem Code-Review: Preise nur mit Recht, Nachkalkulation
// über alle Aufträge, Suche in Kunden- und Projektlisten
describe('Review: Preise, Nachkalkulation, Suche', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  let staff: { Authorization: string };
  let projectId: string;
  const api = () => request(app.getHttpServer());

  // Angebot mit einer freien Position bis zum Auftrag durchreichen
  async function order(amount: number) {
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({
        projectId,
        lineItems: [
          { description: 'Pauschale', unit: 'psch', quantity: 1, unitPrice: amount, costPerUnit: 0 },
        ],
      })
      .expect(201);
    await api().post(`/quotes/${quote.body.id}/approve`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/send`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/outcome`).set(auth).send({ status: 'accepted' }).expect(201);
    return (await api().post('/orders').set(auth).send({ quoteId: quote.body.id }).expect(201)).body;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Review GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    ({ projectId } = await createProject(app, company.token));
    const role = await prisma.role.create({
      data: {
        companyId: company.companyId,
        name: 'Mitarbeiter',
        permissions: { create: EMPLOYEE_PERMISSIONS.map((key) => ({ permission: { connect: { key } } })) },
      },
    });
    await prisma.user.create({
      data: {
        companyId: company.companyId,
        email: 'kolonne@review.example',
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: 'K',
        lastName: 'K',
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api()
      .post('/auth/login')
      .send({ email: 'kolonne@review.example', password: 'test12345' })
      .expect(201);
    staff = { Authorization: `Bearer ${login.body.accessToken}` };
  });

  afterAll(async () => {
    await app.close();
  });

  it('Aufträge, Materialverbrauch und Nachkalkulation zeigen Preise nur mit Recht', async () => {
    const first = await order(1000);
    await order(500);
    const article = await api()
      .post('/articles')
      .set(auth)
      .send({ articleNumber: 'SPLITT', name: 'Splitt', unit: 't', purchasePrice: 30, salePrice: 45 })
      .expect(201);
    await api()
      .post('/material-usage')
      .set(auth)
      .send({ projectId, articleId: article.body.id, quantity: 2 })
      .expect(201);

    // Admin: alles sichtbar
    const orders = (await api().get(`/orders/by-project/${projectId}`).set(auth).expect(200)).body;
    expect(orders.map((o: { totalNet: string }) => Number(o.totalNet)).sort()).toEqual([1000, 500]);
    const usage = (await api().get(`/material-usage/by-project/${projectId}`).set(auth).expect(200)).body;
    expect(Number(usage[0].article.purchasePrice)).toBe(30);
    const post = (await api().get(`/post-calculation/${projectId}`).set(auth).expect(200)).body;
    expect(post.orders).toBe(2);
    expect(post.material).toMatchObject({ planned: 0, actual: 60 });

    // Mitarbeiter ohne Preisrechte: keine Beträge
    const staffOrders = (await api().get(`/orders/by-project/${projectId}`).set(staff).expect(200)).body;
    expect(staffOrders).toHaveLength(2);
    expect(staffOrders[0].totalNet).toBeUndefined();
    const single = (await api().get(`/orders/${first.id}`).set(staff).expect(200)).body;
    expect(single.totalNet).toBeUndefined();
    const staffUsage = (await api().get(`/material-usage/by-project/${projectId}`).set(staff).expect(200))
      .body;
    expect(staffUsage[0].article).toMatchObject({ name: 'Splitt', unit: 't' });
    expect(staffUsage[0].article.purchasePrice).toBeUndefined();
    const staffPost = (await api().get(`/post-calculation/${projectId}`).set(staff).expect(200)).body;
    expect(staffPost.material).toBeNull();
    expect(staffPost.labor).toBeDefined();

    // stornierter Auftrag zählt nicht mehr
    await api().patch(`/orders/${first.id}/status`).set(auth).send({ status: 'cancelled' }).expect(200);
    expect((await api().get(`/post-calculation/${projectId}`).set(auth).expect(200)).body.orders).toBe(1);
  });

  it('Kunden und Projekte durchsuchen, Projekte nach Status filtern', async () => {
    const other = await api()
      .post('/customers')
      .set(auth)
      .send({ name: 'Gärtnerei Lindner', city: 'Bonn' })
      .expect(201);
    const property = await api()
      .post('/properties')
      .set(auth)
      .send({ customerId: other.body.id, label: 'Hof' })
      .expect(201);
    await api()
      .post('/projects')
      .set(auth)
      .send({ propertyId: property.body.id, title: 'Hecke' })
      .expect(201);

    const names = async (q: string) =>
      (await api().get('/customers').query({ q }).set(auth).expect(200)).body.map(
        (c: { name: string }) => c.name,
      );
    expect(await names('lindner')).toEqual(['Gärtnerei Lindner']);
    expect(await names('BONN')).toEqual(['Gärtnerei Lindner']);
    expect(await names('  ')).toHaveLength(2);
    const count = await api().get('/customers').query({ q: 'muster' }).set(auth).expect(200);
    expect(count.headers['x-total-count']).toBe('1');

    const titles = async (query: Record<string, string>) =>
      (await api().get('/projects').query(query).set(auth).expect(200)).body.map(
        (p: { title: string }) => p.title,
      );
    // nach Kundenname, Titel und Status
    expect(await titles({ q: 'lindner' })).toEqual(['Hecke']);
    expect(await titles({ q: 'terrasse' })).toEqual(['Terrasse anlegen']);
    expect(await titles({ status: 'in_progress' })).toEqual(['Terrasse anlegen']);
    expect(await titles({ status: 'open' })).toEqual(['Hecke']);
    // unbekannter Status filtert nicht
    expect(await titles({ status: 'egal' })).toHaveLength(2);
    await api()
      .get('/customers')
      .query({ q: 'x'.repeat(101) })
      .set(auth)
      .expect(400);
  });
});
