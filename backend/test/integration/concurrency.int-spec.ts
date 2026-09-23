import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// Mehrere Anfragen gleichzeitig – wie ein Doppelklick oder zwei Geräte.
// Von jeder Gruppe darf genau eine Anfrage durchgehen, und keine darf mit
// einem 500er scheitern.
describe('Gleichzeitige Anfragen', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  let projectId: string;
  let serviceId: string;

  const api = () => request(app.getHttpServer());
  const statuses = (responses: request.Response[]) => responses.map((r) => r.status).sort();
  const parallel = (n: number, fn: () => request.Test) => Promise.all(Array.from({ length: n }, fn));

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Parallel GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    ({ projectId } = await createProject(app, company.token));
    const service = await api()
      .post('/services')
      .set(auth)
      .send({ name: 'Hecke schneiden', unit: 'm' })
      .expect(201);
    serviceId = service.body.id;
    await api().post(`/services/${serviceId}/components`).set(auth).send({ laborMinutes: 5 }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  async function sentQuote() {
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({ projectId, lineItems: [{ serviceId, quantity: 10 }] })
      .expect(201);
    await api().post(`/quotes/${quote.body.id}/approve`).set(auth).expect(201);
    await api().post(`/quotes/${quote.body.id}/send`).set(auth).expect(201);
    return quote.body.id as string;
  }

  it('fünfmal gleichzeitig "Start" ergibt genau eine laufende Zeiterfassung', async () => {
    const responses = await parallel(5, () =>
      api().post('/time-entries/start').set(auth).send({ projectId }),
    );
    expect(statuses(responses)).toEqual([201, 400, 400, 400, 400]);
    expect(await prisma.timeEntry.count({ where: { employeeId: company.employeeId, status: 'open' } })).toBe(
      1,
    );
    await api().post('/time-entries/stop').set(auth).send({}).expect(201);
  });

  it('fünf gleichzeitige Termine im selben Zeitfenster: nur einer wird angelegt', async () => {
    const responses = await parallel(5, () =>
      api().post('/appointments').set(auth).send({
        projectId,
        title: 'Hecke schneiden',
        startTime: '2026-11-03T08:00:00.000Z',
        endTime: '2026-11-03T10:00:00.000Z',
        assignedUserId: company.userId,
      }),
    );
    expect(statuses(responses)).toEqual([201, 400, 400, 400, 400]);
  });

  it('"angenommen" und "abgelehnt" gleichzeitig: nur eine Entscheidung zählt', async () => {
    const quoteId = await sentQuote();
    const responses = await Promise.all([
      api().post(`/quotes/${quoteId}/outcome`).set(auth).send({ status: 'accepted' }),
      api().post(`/quotes/${quoteId}/outcome`).set(auth).send({ status: 'rejected' }),
    ]);
    expect(statuses(responses)).toEqual([201, 400]);
    const winner = responses.find((r) => r.status === 201)!.body.status;
    const stored = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    expect(stored.status).toBe(winner);
  });

  it('Doppelklick auf "Auftrag erzeugen": ein Auftrag, der zweite Klick ergibt 400 statt 500', async () => {
    const quoteId = await sentQuote();
    await api().post(`/quotes/${quoteId}/outcome`).set(auth).send({ status: 'accepted' }).expect(201);
    const responses = await parallel(3, () => api().post('/orders').set(auth).send({ quoteId }));
    expect(statuses(responses)).toEqual([201, 400, 400]);
    expect(await prisma.order.count({ where: { quoteId } })).toBe(1);
  });

  it('Auftragsstatus folgt festen Übergängen', async () => {
    const quoteId = await sentQuote();
    await api().post(`/quotes/${quoteId}/outcome`).set(auth).send({ status: 'accepted' }).expect(201);
    const order = await api().post('/orders').set(auth).send({ quoteId }).expect(201);
    const setStatus = (status: string) =>
      api().patch(`/orders/${order.body.id}/status`).set(auth).send({ status });

    await setStatus('done').expect(400); // nicht direkt von "offen" auf "erledigt"
    await setStatus('in_progress').expect(200);
    await setStatus('done').expect(200);
    await setStatus('open').expect(400); // erledigt ist endgültig
    await setStatus('cancelled').expect(400);
  });
});
