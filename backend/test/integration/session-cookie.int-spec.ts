import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

// Browser-Sitzung im httpOnly-Cookie, CSRF-Schutz und CORS.
describe('Sitzung per Cookie', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Cookie GmbH');
  });

  afterAll(async () => {
    await app.close();
  });

  async function loginCookie() {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: company.userId } });
    const res = await api()
      .post('/auth/login')
      .send({ email: user.email, password: 'test12345' })
      .expect(201);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('gartenai_session='),
    );
    return { res, cookie: cookie!, pair: cookie!.split(';')[0] };
  }

  it('Login setzt ein httpOnly-Cookie (SameSite=Lax), das Token bleibt für API-Clients in der Antwort', async () => {
    const { res, cookie } = await loginCookie();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/i); // Test läuft ohne HTTPS
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  it('das Cookie meldet an: /auth/me und normale Abfragen', async () => {
    const { pair } = await loginCookie();
    const me = await api().get('/auth/me').set('Cookie', pair).expect(200);
    expect(me.body).toMatchObject({
      id: company.userId,
      permissions: expect.arrayContaining(['customer.read']),
    });
    expect(me.body.passwordHash).toBeUndefined();
    await api().get('/customers').set('Cookie', pair).expect(200);
    await api().get('/auth/me').expect(401);
    await api().get('/auth/me').set('Cookie', 'gartenai_session=kaputt').expect(401);
  });

  it('ändernde Anfragen mit Cookie brauchen X-Requested-With (CSRF-Schutz)', async () => {
    const { pair } = await loginCookie();
    const blocked = await api()
      .post('/customers')
      .set('Cookie', pair)
      .send({ name: 'Ohne Header' })
      .expect(403);
    expect(blocked.body.message).toContain('CSRF');
    await api()
      .post('/customers')
      .set('Cookie', pair)
      .set('X-Requested-With', 'fetch')
      .send({ name: 'Mit Header' })
      .expect(201);
    // Bearer-Clients sind nicht betroffen
    await api()
      .post('/customers')
      .set({ Authorization: `Bearer ${company.token}` })
      .send({ name: 'API-Client' })
      .expect(201);
  });

  it('Logout löscht das Cookie', async () => {
    const res = await api().post('/auth/logout').set('X-Requested-With', 'fetch').expect(200);
    const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('gartenai_session='),
    );
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('Secure-Flag in Produktion bzw. mit COOKIE_SECURE=1', async () => {
    process.env.COOKIE_SECURE = '1';
    try {
      const { cookie } = await loginCookie();
      expect(cookie).toMatch(/Secure/);
    } finally {
      delete process.env.COOKIE_SECURE;
    }
  });

  it('CORS nur für das eigene Frontend, mit Cookies', async () => {
    const own = await api().get('/health').set('Origin', 'http://localhost:5173').expect(200);
    expect(own.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(own.headers['access-control-allow-credentials']).toBe('true');
    const foreign = await api().get('/health').set('Origin', 'https://evil.example').expect(200);
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });
});
