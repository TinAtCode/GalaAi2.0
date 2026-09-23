import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// Status-, Nutzer- und Rechteänderungen landen im Audit-Log: wer, wann, von
// welchem Wert auf welchen.
describe('Audit-Log für Status- und Rechteänderungen', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  const api = () => request(app.getHttpServer());
  const entries = (action: string, entityId?: string) =>
    prisma.auditLog.findMany({
      where: { companyId: company.companyId, action, ...(entityId ? { entityId } : {}) },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Audit GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
  });

  afterAll(async () => {
    await app.close();
  });

  it('Angebot, Auftrag und Projekt: jeder Statuswechsel mit altem und neuem Wert', async () => {
    const { projectId } = await createProject(app, company.token);
    const service = await api().post('/services').set(auth).send({ name: 'Rasen', unit: 'm2' }).expect(201);
    await api()
      .post(`/services/${service.body.id}/components`)
      .set(auth)
      .send({ laborMinutes: 5 })
      .expect(201);
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({ projectId, lineItems: [{ serviceId: service.body.id, quantity: 10 }] })
      .expect(201);
    const quoteId = quote.body.id;

    await api().post(`/quotes/${quoteId}/approve`).set(auth).expect(201);
    await api().post(`/quotes/${quoteId}/send`).set(auth).expect(201);
    await api().post(`/quotes/${quoteId}/approve`).set(auth).expect(400); // kein Eintrag
    await api().post(`/quotes/${quoteId}/outcome`).set(auth).send({ status: 'accepted' }).expect(201);

    const quoteLog = await entries('quote_status', quoteId);
    expect(quoteLog.map((e) => [e.oldData, e.newData])).toEqual([
      [{ status: 'draft' }, { status: 'approved' }],
      [{ status: 'approved' }, { status: 'sent' }],
      [{ status: 'sent' }, { status: 'accepted' }],
    ]);
    expect(quoteLog.every((e) => e.userId === company.userId && e.entity === 'Quote')).toBe(true);

    const order = await api().post('/orders').set(auth).send({ quoteId }).expect(201);
    await api()
      .patch(`/orders/${order.body.id}/status`)
      .set(auth)
      .send({ status: 'in_progress' })
      .expect(200);
    await api().patch(`/orders/${order.body.id}/status`).set(auth).send({ status: 'open' }).expect(400);
    const orderLog = await entries('order_status', order.body.id);
    expect(orderLog.map((e) => [e.oldData, e.newData])).toEqual([
      [{ status: 'open' }, { status: 'in_progress' }],
    ]);

    await api().patch(`/projects/${projectId}/status`).set(auth).send({ status: 'done' }).expect(200);
    await api().patch(`/projects/${projectId}/status`).set(auth).send({ status: 'done' }).expect(200); // unverändert
    const projectLog = await entries('project_status', projectId);
    expect(projectLog.map((e) => [e.oldData, e.newData])).toEqual([
      [{ status: 'in_progress' }, { status: 'done' }],
    ]);
  });

  it('gleichzeitige Statuswechsel: nur einer gelingt, nur einer wird protokolliert', async () => {
    const { projectId } = await createProject(app, company.token);
    const service = await api().post('/services').set(auth).send({ name: 'Hecke', unit: 'm' }).expect(201);
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({ projectId, lineItems: [{ serviceId: service.body.id, quantity: 1 }] })
      .expect(201);
    await api().post(`/quotes/${quote.body.id}/approve`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/send`).set(auth).expect(201);

    const results = await Promise.all(
      (['accepted', 'rejected'] as const).map((status) =>
        api().post(`/quotes/${quote.body.id}/outcome`).set(auth).send({ status }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    const outcomes = (await entries('quote_status', quote.body.id)).filter(
      (e) => (e.oldData as { status: string }).status === 'sent',
    );
    expect(outcomes).toHaveLength(1);
    const final = await prisma.quote.findUniqueOrThrow({ where: { id: quote.body.id } });
    expect((outcomes[0].newData as { status: string }).status).toBe(final.status);
  });

  it('Nutzer sperren, Passwort zurücksetzen, Rollen und Rechte ändern', async () => {
    const created = await api()
      .post('/users')
      .set(auth)
      .send({ email: 'kollegin@audit.example', firstName: 'Kim', lastName: 'Klee', password: 'geheim12345' })
      .expect(201);
    const userId = created.body.id;

    await api().patch(`/users/${userId}`).set(auth).send({ active: false, firstName: 'Kim' }).expect(200);
    const [update] = await entries('user_update', userId);
    expect(update).toMatchObject({
      userId: company.userId,
      oldData: { active: true },
      newData: { active: false },
    });

    await api().post(`/users/${userId}/password`).set(auth).send({ password: 'neuesPasswort1' }).expect(201);
    const [reset] = await entries('user_password_reset', userId);
    expect(reset.userId).toBe(company.userId);
    expect(JSON.stringify(reset)).not.toContain('neuesPasswort1');

    const role = await api()
      .post('/roles')
      .set(auth)
      .send({ name: 'Büro', permissionKeys: ['customer.read'] })
      .expect(201);
    await api()
      .patch(`/roles/${role.body.id}/permissions`)
      .set(auth)
      .send({ permissionKeys: ['customer.read', 'customer.write'] })
      .expect(200);
    const [permissions] = await entries('role_permissions', role.body.id);
    expect(permissions).toMatchObject({
      oldData: { permissions: ['customer.read'] },
      newData: { permissions: ['customer.read', 'customer.write'] },
    });

    await api().post(`/roles/${role.body.id}/assign`).set(auth).send({ userId }).expect(201);
    await api().delete(`/roles/${role.body.id}/assign/${userId}`).set(auth).expect(200);
    await api().delete(`/roles/${role.body.id}/assign/${userId}`).set(auth).expect(200); // nichts zu entfernen
    expect(await entries('user_role_assign', userId)).toMatchObject([{ newData: { role: 'Büro' } }]);
    expect(await entries('user_role_remove', userId)).toMatchObject([{ oldData: { role: 'Büro' } }]);
  });
});
