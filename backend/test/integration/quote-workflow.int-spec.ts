import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// Der Kernablauf einmal komplett gegen die echte Datenbank: Stammdaten ->
// Kalkulation -> Angebot -> Auftrag -> Zeiterfassung/Material ->
// Nachkalkulation. Genau diese Kette war mit dem gemockten Prisma-Client
// "grün", obwohl die Relation ServiceComponent -> Article fehlte.
describe('Angebots-Workflow gegen PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  let projectId: string;
  let serviceId: string;
  let articleId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Gartenbau Grün');
    auth = { Authorization: `Bearer ${company.token}` };
    ({ projectId } = await createProject(app, company.token));
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  it('legt eine Dienstleistung mit Material- und Arbeitszeit-Bestandteil an', async () => {
    const article = await api()
      .post('/articles')
      .set(auth)
      .send({ articleNumber: 'SCH-01', name: 'Schotter', unit: 't', purchasePrice: 1.99, salePrice: 2.5 })
      .expect(201);
    articleId = article.body.id;

    const service = await api()
      .post('/services')
      .set(auth)
      .send({ name: '1 m² Unterbau', unit: 'm2' })
      .expect(201);
    serviceId = service.body.id;

    await api()
      .post(`/services/${serviceId}/components`)
      .set(auth)
      .send({ articleId, quantityPer: 0.3333 })
      .expect(201);
    await api().post(`/services/${serviceId}/components`).set(auth).send({ laborMinutes: 6 }).expect(201);

    const loaded = await api().get(`/services/${serviceId}`).set(auth).expect(200);
    expect(loaded.body.components).toHaveLength(2);
    expect(loaded.body.components.find((c: any) => c.articleId).article.name).toBe('Schotter');
  });

  it('kalkuliert mit den Firmen-Standardwerten ohne Zwischenrundung', async () => {
    // Material 0,663267 + Arbeit 6 Min × 45 €/h = 4,50 → 5,163267
    // + 15 % Gemeinkosten = 5,93775705 → × 1,2 = 7,12530846 → 7,13 €/m²
    const res = await api().post('/calculations').set(auth).send({ serviceId, quantity: 1000 }).expect(201);
    expect(res.body.costPerUnit).toBe(5.94);
    expect(res.body.salePricePerUnit).toBe(7.13);
    expect(res.body.salePriceTotal).toBe(7130);
    expect(res.body.costTotal).toBe(5937.76);
  });

  it('führt ein Angebot bis zum Auftrag und setzt das Projekt in Bearbeitung', async () => {
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({ projectId, lineItems: [{ serviceId, quantity: 1000 }] })
      .expect(201);
    expect(quote.body.status).toBe('draft');
    expect(Number(quote.body.totalNet)).toBe(7130);

    // Kein Auftrag aus einem Entwurf
    await api().post('/orders').set(auth).send({ quoteId: quote.body.id }).expect(400);

    await api().post(`/quotes/${quote.body.id}/approve`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/send`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/outcome`).set(auth).send({ status: 'accepted' }).expect(201);

    const order = await api().post('/orders').set(auth).send({ quoteId: quote.body.id }).expect(201);
    expect(Number(order.body.totalNet)).toBe(7130);
    // Höchstens ein Auftrag je Angebot
    await api().post('/orders').set(auth).send({ quoteId: quote.body.id }).expect(400);

    const project = await api().get(`/projects/${projectId}`).set(auth).expect(200);
    expect(project.body.status).toBe('in_progress');
  });

  it('lehnt ungültige Status-Werte ab', async () => {
    await api().patch(`/projects/${projectId}/status`).set(auth).send({ status: 'fertig' }).expect(400);
  });

  it('Zeiterfassung: kein zweiter Start, solange eine läuft', async () => {
    await api().post('/time-entries/start').set(auth).send({ projectId }).expect(201);
    await api().post('/time-entries/start').set(auth).send({ projectId }).expect(400);
    const stopped = await api().post('/time-entries/stop').set(auth).send({}).expect(201);
    expect(stopped.body.status).toBe('completed');
  });

  it('Nachkalkulation: Soll aus dem Auftrag, Ist aus gebuchtem Material', async () => {
    await api().post('/material-usage').set(auth).send({ projectId, articleId, quantity: 400 }).expect(201);

    const res = await api().get(`/post-calculation/${projectId}`).set(auth).expect(200);
    // Soll: 1000 m² × 6 Min = 6000 Min; Material 1000 × 0,663267 €
    expect(res.body.labor.planned).toBe(6000);
    expect(res.body.material.planned).toBe(663.27);
    expect(res.body.material.actual).toBe(796); // 400 t × 1,99 €
  });
  it('eine spätere Rezepturänderung verändert das Soll des bestehenden Auftrags nicht', async () => {
    const before = await api().get(`/post-calculation/${projectId}`).set(auth).expect(200);

    // Rezeptur nachträglich ändern: mehr Arbeitszeit, Materialpreis rauf
    await api().post(`/services/${serviceId}/components`).set(auth).send({ laborMinutes: 30 }).expect(201);
    await api().patch(`/articles/${articleId}`).set(auth).send({ purchasePrice: 5 }).expect(200);

    const after = await api().get(`/post-calculation/${projectId}`).set(auth).expect(200);
    expect(after.body.labor.planned).toBe(before.body.labor.planned);
    expect(after.body.material.planned).toBe(before.body.material.planned);
  });

  it('Maschinen fließen in die Kalkulation ein – nur Maschinen der eigenen Firma', async () => {
    const machine = await api()
      .post('/machines')
      .set(auth)
      .send({ name: 'Rüttelplatte', hourlyRate: 30 })
      .expect(201);
    const service = await api()
      .post('/services')
      .set(auth)
      .send({ name: '1 m² verdichten', unit: 'm2' })
      .expect(201);
    await api()
      .post(`/services/${service.body.id}/components`)
      .set(auth)
      .send({ machineId: machine.body.id, machineMinutes: 6 })
      .expect(201);

    const calc = await api()
      .post('/calculations')
      .set(auth)
      .send({
        serviceId: service.body.id,
        quantity: 100,
        overheadPercentOverride: 0,
        surchargePercentOverride: 0,
      })
      .expect(201);
    expect(calc.body.machineCostPerUnit).toBe(3); // 6 Min. à 30 €/h
    expect(calc.body.machineCostTotal).toBe(300);
    expect(calc.body.salePriceTotal).toBe(300);

    // Ohne price.purchase.read ist der Stundensatz der Maschine nicht sichtbar
    const viewerRole = await prisma.role.create({
      data: {
        companyId: company.companyId,
        name: 'Nur lesen',
        permissions: { create: [{ permission: { connect: { key: 'customer.read' } } }] },
      },
    });
    await api()
      .post('/users')
      .set(auth)
      .send({
        email: 'viewer@quote.test',
        firstName: 'V',
        lastName: 'W',
        password: 'viewerpass1',
        roleIds: [viewerRole.id],
      })
      .expect(201);
    const viewer = await api()
      .post('/auth/login')
      .send({ email: 'viewer@quote.test', password: 'viewerpass1' })
      .expect(201);
    const asViewer = await api()
      .get(`/services/${service.body.id}`)
      .set({ Authorization: `Bearer ${viewer.body.accessToken}` })
      .expect(200);
    expect(asViewer.body.components[0].machine.name).toBe('Rüttelplatte');
    expect(asViewer.body.components[0].machine.hourlyRate).toBeUndefined();

    const other = await createCompany(app, prisma, 'Maschinen-Fremd GmbH');
    const foreign = await api()
      .post('/machines')
      .set({ Authorization: `Bearer ${other.token}` })
      .send({ name: 'Fremdbagger', hourlyRate: 1 })
      .expect(201);
    await api()
      .post(`/services/${service.body.id}/components`)
      .set(auth)
      .send({ machineId: foreign.body.id, machineMinutes: 5 })
      .expect(404);
  });
});
