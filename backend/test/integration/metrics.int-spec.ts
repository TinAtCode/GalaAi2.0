import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { MetricsHistoryService } from '../../src/metrics/metrics-history.service';
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

  // Verlauf für die Alarmschwellen: ein Messpunkt je Minute in der Datenbank
  it('speichert Messpunkte und wertet sie über /metrics/history aus', async () => {
    process.env.METRICS_TOKEN = 'geheim-123';
    const history = app.get(MetricsHistoryService);
    const auth = { Authorization: `Bearer ${company.token}` };
    // in Tests aus – der erste Aufruf setzt nur den Ausgangsstand
    expect(await history.flush()).toBeNull();
    await api().get('/customers').set(auth).expect(200);
    await api().get('/customers').set(auth).expect(200);
    await api().get('/gibt-es-nicht').expect(404);
    const saved = await history.flush();
    expect(saved).toMatchObject({ requests: 3, serverErrors: 0, mailFailures: 0 });
    expect(saved!.latencyBuckets.reduce((sum, n) => sum + n, 0)).toBe(3);
    expect(saved!.rssBytes).toBeGreaterThan(0);

    // alte Messpunkte fallen nach METRICS_HISTORY_DAYS weg
    await prisma.metricSample.create({
      data: {
        at: new Date(Date.now() - 100 * 86_400_000),
        instance: 'alt',
        requests: 1,
        serverErrors: 0,
        latencyBuckets: [],
        eventLoopP99Seconds: 0,
        rssBytes: 0,
        ocrWaiting: 0,
        mailFailures: 0,
      },
    });
    await history.prune();
    expect(await prisma.metricSample.count({ where: { instance: 'alt' } })).toBe(0);

    await api().get('/metrics/history').expect(401);
    await api().get('/metrics/history').set(auth).expect(401);
    const report = await api()
      .get('/metrics/history?days=7')
      .set('Authorization', 'Bearer geheim-123')
      .expect(200);
    expect(report.body).toMatchObject({ samples: 1, instances: 1, enoughData: false });
    expect(report.body.rules.map((r: { alert: string }) => r.alert)).toContain('LangsameAntworten');
    const text = await api()
      .get('/metrics/history?format=text')
      .set('Authorization', 'Bearer geheim-123')
      .expect(200);
    expect(text.text).toContain('Alarmschwellen');

    // die Auswertung zählt sich selbst nicht mit
    await history.flush();
    const metrics = await api().get('/metrics').set('Authorization', 'Bearer geheim-123').expect(200);
    expect(metrics.text).not.toContain('route="/metrics/history"');
  });
});
