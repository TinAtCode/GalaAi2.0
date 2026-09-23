import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

// Das allgemeine Anfrage-Limit zählt je Nutzer, nicht je IP: Kollegen hinter
// derselben Büro-IP nehmen sich kein Kontingent weg. Ein gefälschtes Token
// zählt wie eine anonyme Anfrage (je IP).
describe('Anfrage-Limit je Nutzer', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let a: TestCompany;
  let b: TestCompany;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    a = await createCompany(app, prisma, 'Limit A');
    b = await createCompany(app, prisma, 'Limit B');
    process.env.RATE_LIMIT = '3';
  });

  afterAll(async () => {
    delete process.env.RATE_LIMIT;
    await app.close();
  });

  const get = (token?: string) => {
    const req = api().get('/customers');
    return token ? req.set({ Authorization: `Bearer ${token}` }) : req;
  };

  it('jeder Nutzer hat sein eigenes Kontingent, auch von derselben IP', async () => {
    for (let i = 0; i < 3; i++) await get(a.token).expect(200);
    await get(a.token).expect(429);
    await get(b.token).expect(200); // gleiche IP, anderer Nutzer
  });

  it('ein gefälschtes Token zählt je IP wie anonyme Anfragen', async () => {
    const [header, payload] = b.token.split('.');
    const forged = `${header}.${payload}.gefaelscht`;
    for (let i = 0; i < 3; i++) await get(forged).expect(401);
    await get(forged).expect(429);
    await get().expect(429); // dasselbe IP-Kontingent
  });
});
