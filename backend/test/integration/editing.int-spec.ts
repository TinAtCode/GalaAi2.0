import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

describe('Bearbeiten von Kunden, Projekten und Stammdaten', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let a: TestCompany;
  let b: TestCompany;
  let ids: { customerId: string; propertyId: string; projectId: string };

  const api = () => request(app.getHttpServer());
  const as = (c: TestCompany) => ({ Authorization: `Bearer ${c.token}` });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    a = await createCompany(app, prisma, 'Edit A');
    b = await createCompany(app, prisma, 'Edit B');
    ids = await createProject(app, a.token);
  });

  afterAll(async () => {
    await app.close();
  });

  it('Kunde, Objekt und Projekt lassen sich korrigieren – nur von der eigenen Firma', async () => {
    const customer = await api()
      .patch(`/customers/${ids.customerId}`)
      .set(as(a))
      .send({ phone: '0221 123456' })
      .expect(200);
    expect(customer.body).toMatchObject({ name: 'Familie Muster', phone: '0221 123456' });

    await api().patch(`/properties/${ids.propertyId}`).set(as(a)).send({ city: 'Bonn' }).expect(200);
    const project = await api()
      .patch(`/projects/${ids.projectId}`)
      .set(as(a))
      .send({ title: 'Terrasse und Zaun' })
      .expect(200);
    expect(project.body.title).toBe('Terrasse und Zaun');

    await api().patch(`/customers/${ids.customerId}`).set(as(b)).send({ name: 'Übernommen' }).expect(404);
    await api().patch(`/properties/${ids.propertyId}`).set(as(b)).send({ city: 'X' }).expect(404);
    await api().patch(`/projects/${ids.projectId}`).set(as(b)).send({ title: 'Übernommen' }).expect(404);
  });

  it('ein Objekt kann nicht zu einem anderen Kunden verschoben werden', async () => {
    await api()
      .patch(`/properties/${ids.propertyId}`)
      .set(as(a))
      .send({ customerId: ids.customerId })
      .expect(400);
  });

  it('Preisänderungen am Artikel werden mit altem und neuem Wert protokolliert', async () => {
    const article = await api()
      .post('/articles')
      .set(as(a))
      .send({ articleNumber: 'K-1', name: 'Kies', unit: 't', purchasePrice: 20, salePrice: 30 })
      .expect(201);

    await api()
      .patch(`/articles/${article.body.id}`)
      .set(as(a))
      .send({ purchasePrice: 22.5, name: 'Kies' })
      .expect(200);

    const logs = await prisma.auditLog.findMany({ where: { entityId: article.body.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: 'article_update',
      userId: a.userId,
      oldData: { purchasePrice: 20 },
      newData: { purchasePrice: 22.5 },
    });

    // Keine Änderung -> kein Eintrag
    await api().patch(`/articles/${article.body.id}`).set(as(a)).send({ purchasePrice: 22.5 }).expect(200);
    expect(await prisma.auditLog.count({ where: { entityId: article.body.id } })).toBe(1);

    await api().patch(`/articles/${article.body.id}`).set(as(b)).send({ purchasePrice: 1 }).expect(404);
  });

  it('eine doppelte Artikelnummer ergibt 409', async () => {
    await api()
      .post('/articles')
      .set(as(a))
      .send({ articleNumber: 'K-2', name: 'Sand', unit: 't', purchasePrice: 10, salePrice: 15 })
      .expect(201);
    const kies = await prisma.article.findFirstOrThrow({
      where: { companyId: a.companyId, articleNumber: 'K-1' },
    });
    await api().patch(`/articles/${kies.id}`).set(as(a)).send({ articleNumber: 'K-2' }).expect(409);
  });

  it('Maschinen, Lieferanten und Rezepturen lassen sich pflegen', async () => {
    const machine = await api()
      .post('/machines')
      .set(as(a))
      .send({ name: 'Minibagger', hourlyRate: 45 })
      .expect(201);
    await api().patch(`/machines/${machine.body.id}`).set(as(a)).send({ hourlyRate: 49 }).expect(200);
    expect(await prisma.auditLog.count({ where: { entityId: machine.body.id } })).toBe(1);

    const supplier = await api().post('/suppliers').set(as(a)).send({ name: 'Baustoff Meyer' }).expect(201);
    await api().patch(`/suppliers/${supplier.body.id}`).set(as(a)).send({ active: false }).expect(200);

    const service = await api().post('/services').set(as(a)).send({ name: 'Rasen', unit: 'm2' }).expect(201);
    const component = await api()
      .post(`/services/${service.body.id}/components`)
      .set(as(a))
      .send({ laborMinutes: 3 })
      .expect(201);
    await api()
      .patch(`/services/${service.body.id}`)
      .set(as(a))
      .send({ name: 'Rollrasen verlegen' })
      .expect(200);
    await api().delete(`/services/${service.body.id}/components/${component.body.id}`).set(as(b)).expect(404);
    await api().delete(`/services/${service.body.id}/components/${component.body.id}`).set(as(a)).expect(200);
    const loaded = await api().get(`/services/${service.body.id}`).set(as(a)).expect(200);
    expect(loaded.body).toMatchObject({ name: 'Rollrasen verlegen', components: [] });
  });
});
