import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

describe('Seitenweises Laden', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Seiten GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    for (const name of ['Kunde Eins', 'Kunde Zwei', 'Kunde Drei']) {
      await api().post('/customers').set(auth).send({ name }).expect(201);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('liefert höchstens take Einträge und die Gesamtzahl im Header', async () => {
    const first = await api().get('/customers?take=2').set(auth).expect(200);
    expect(first.body).toHaveLength(2);
    expect(first.headers['x-total-count']).toBe('3');

    const rest = await api().get('/customers?take=2&skip=2').set(auth).expect(200);
    expect(rest.body).toHaveLength(1);
    const allIds = [...first.body, ...rest.body].map((c: { id: string }) => c.id);
    expect(new Set(allIds).size).toBe(3);
  });

  it('ohne Parameter bleibt die Antwort ein Array (Frontend unverändert)', async () => {
    const res = await api().get('/customers').set(auth).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.headers['x-total-count']).toBe('3');
    // Der Header ist für das Frontend (anderer Origin) freigegeben
    expect(res.headers['access-control-expose-headers']).toContain('X-Total-Count');
  });

  it('lehnt unsinnige Werte ab', async () => {
    await api().get('/customers?take=100000').set(auth).expect(400);
    await api().get('/customers?take=abc').set(auth).expect(400);
    await api().get('/customers?skip=-1').set(auth).expect(400);
  });

  it.each(['/projects', '/articles', '/documents', '/time-entries/mine'])(
    '%s liefert X-Total-Count',
    async (path) => {
      const res = await api().get(path).set(auth).expect(200);
      expect(res.headers['x-total-count']).toBeDefined();
    },
  );
});
