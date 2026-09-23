import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// Firma B kennt die IDs von Firma A (z.B. aus einer geleakten URL) und
// versucht, über jeden Endpunkt an deren Daten zu kommen – über HTTP, mit
// echtem Login und echter Datenbank.
describe('Mandantentrennung über die API', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let a: TestCompany;
  let b: TestCompany;
  const ids: Record<string, string> = {};

  const api = () => request(app.getHttpServer());
  const as = (c: TestCompany) => ({ Authorization: `Bearer ${c.token}` });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    a = await createCompany(app, prisma, 'Firma A');
    b = await createCompany(app, prisma, 'Firma B');

    Object.assign(ids, await createProject(app, a.token));
    const article = await api()
      .post('/articles')
      .set(as(a))
      .send({ articleNumber: 'A-1', name: 'Rasen', unit: 'm2', purchasePrice: 3, salePrice: 5 })
      .expect(201);
    ids.articleId = article.body.id;
    const service = await api()
      .post('/services')
      .set(as(a))
      .send({ name: 'Rasen legen', unit: 'm2' })
      .expect(201);
    ids.serviceId = service.body.id;
    await api()
      .post(`/services/${ids.serviceId}/components`)
      .set(as(a))
      .send({ articleId: ids.articleId, quantityPer: 1 })
      .expect(201);
    const quote = await api()
      .post('/quotes')
      .set(as(a))
      .send({ projectId: ids.projectId, lineItems: [{ serviceId: ids.serviceId, quantity: 10 }] })
      .expect(201);
    ids.quoteId = quote.body.id;
    const appointment = await api()
      .post('/appointments')
      .set(as(a))
      .send({
        projectId: ids.projectId,
        title: 'Aufmaß',
        startTime: '2026-10-01T08:00:00.000Z',
        assignedUserId: a.userId,
      })
      .expect(201);
    ids.appointmentId = appointment.body.id;
    const document = await api()
      .post('/documents/upload')
      .set(as(a))
      .query({ projectId: ids.projectId })
      .attach('file', Buffer.from('Aufmaß Familie Muster'), 'aufmass.txt')
      .expect(201);
    ids.documentId = document.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['Kunde', () => `/customers/${ids.customerId}`],
    ['Objekt', () => `/properties/${ids.propertyId}`],
    ['Objekte eines Kunden', () => `/properties/by-customer/${ids.customerId}`],
    ['Projekt', () => `/projects/${ids.projectId}`],
    ['Projekte eines Objekts', () => `/projects/by-property/${ids.propertyId}`],
    ['Angebot', () => `/quotes/${ids.quoteId}`],
    ['Angebote eines Projekts', () => `/quotes/by-project/${ids.projectId}`],
    ['Artikel', () => `/articles/${ids.articleId}`],
    ['Dienstleistung', () => `/services/${ids.serviceId}`],
    ['Dokument', () => `/documents/${ids.documentId}`],
    ['Dokument-Download', () => `/documents/${ids.documentId}/download`],
    ['Dokumente eines Projekts', () => `/documents/by-project/${ids.projectId}`],
    ['Materialbuchungen eines Projekts', () => `/material-usage/by-project/${ids.projectId}`],
    ['Nachkalkulation', () => `/post-calculation/${ids.projectId}`],
    ['Zeiten eines Mitarbeiters', () => `/time-entries/by-employee/${a.employeeId}`],
  ])('%s von Firma A ist für Firma B nicht auffindbar (404)', async (_label, path) => {
    await api().get(path()).set(as(b)).expect(404);
  });

  it('Listen von Firma B enthalten nichts von Firma A', async () => {
    for (const path of ['/customers', '/projects', '/articles', '/services', '/documents']) {
      const res = await api().get(path).set(as(b)).expect(200);
      expect(res.body).toEqual([]);
    }
    // Termine eines fremden Projekts: leere Liste statt Daten
    const appointments = await api().get(`/appointments/by-project/${ids.projectId}`).set(as(b)).expect(200);
    expect(appointments.body).toEqual([]);
  });

  it('Firma B kann nichts an Daten von Firma A anhängen oder ändern', async () => {
    await api()
      .post('/properties')
      .set(as(b))
      .send({ customerId: ids.customerId, label: 'Fremdes Objekt' })
      .expect(404);
    await api().post('/projects').set(as(b)).send({ propertyId: ids.propertyId, title: 'xx' }).expect(404);
    await api()
      .post('/quotes')
      .set(as(b))
      .send({ projectId: ids.projectId, lineItems: [{ serviceId: ids.serviceId, quantity: 1 }] })
      .expect(404);
    await api()
      .post('/appointments')
      .set(as(b))
      .send({ projectId: ids.projectId, title: 'Fremder Termin', startTime: '2026-10-01T10:00:00.000Z' })
      .expect(404);
    await api().post('/time-entries/start').set(as(b)).send({ projectId: ids.projectId }).expect(404);
    await api()
      .post('/material-usage')
      .set(as(b))
      .send({ projectId: ids.projectId, articleId: ids.articleId, quantity: 1 })
      .expect(404);
    await api().post(`/quotes/${ids.quoteId}/approve`).set(as(b)).expect(404);
    await api()
      .patch(`/projects/${ids.projectId}/status`)
      .set(as(b))
      .send({ status: 'cancelled' })
      .expect(404);
    await api()
      .patch(`/appointments/${ids.appointmentId}/status`)
      .set(as(b))
      .send({ status: 'cancelled' })
      .expect(404);
    await api().post('/orders').set(as(b)).send({ quoteId: ids.quoteId }).expect(404);

    // Nichts davon hat bei Firma A etwas verändert
    const project = await api().get(`/projects/${ids.projectId}`).set(as(a)).expect(200);
    expect(project.body.status).toBe('open');
  });

  it('ein manipulierter storagePath liest keine Dateien von Firma A', async () => {
    const stored = await prisma.document.findUniqueOrThrow({ where: { id: ids.documentId } });
    const forged = await api()
      .post('/documents')
      .set(as(b))
      .send({ fileName: 'x.txt', storagePath: `../${stored.storagePath}` })
      .expect(201);
    await api().get(`/documents/${forged.body.id}/download`).set(as(b)).expect(404);
  });

  it('eine companyId im Request-Body wird abgelehnt statt übernommen', async () => {
    await api().post('/customers').set(as(b)).send({ name: 'Trojaner', companyId: a.companyId }).expect(400);
  });
});
