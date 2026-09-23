import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

// Prometheus-Metriken: nur mit METRICS_TOKEN, Routen als Muster statt
// echter Pfade (keine IDs in den Zeitreihen).
describe('Metriken', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Metrik GmbH');
  });

  afterAll(async () => {
    delete process.env.METRICS_TOKEN;
    await app.close();
  });

  it('ohne METRICS_TOKEN abgeschaltet', async () => {
    await api().get('/metrics').expect(404);
  });

  it('nur mit dem richtigen Token', async () => {
    process.env.METRICS_TOKEN = 'geheim-123';
    await api().get('/metrics').expect(401);
    await api().get('/metrics').set('Authorization', 'Bearer falsch').expect(401);
    // ein Login-Token der App reicht nicht
    await api().get('/metrics').set('Authorization', `Bearer ${company.token}`).expect(401);
  });

  it('zählt Anfragen je Routen-Muster, ohne IDs', async () => {
    process.env.METRICS_TOKEN = 'geheim-123';
    const auth = { Authorization: `Bearer ${company.token}` };
    const customer = await api().post('/customers').set(auth).send({ name: 'Familie Linde' }).expect(201);
    await api().get(`/customers/${customer.body.id}`).set(auth).expect(200);
    await api().get('/gibt-es-nicht').expect(404);

    const res = await api().get('/metrics').set('Authorization', 'Bearer geheim-123').expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toMatch(/http_requests_total\{method="GET",route="\/customers\/:id",status="200"\} \d+/);
    expect(res.text).toMatch(/http_requests_total\{method="POST",route="\/customers",status="201"\} \d+/);
    expect(res.text).toMatch(/route="unmatched",status="404"/);
    expect(res.text).toContain('http_request_duration_seconds_bucket');
    expect(res.text).toContain('ocr_queue_running');
    expect(res.text).toContain('process_cpu_user_seconds_total');
    expect(res.text).not.toContain(customer.body.id);
    expect(res.text).not.toContain('route="/metrics"');
  });
});
