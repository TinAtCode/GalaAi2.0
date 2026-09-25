import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { generateKeyPairSync } from 'crypto';
import request from 'supertest';
import { FakeOidc } from '../fixtures/fake-oidc';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

// „Anmelden mit Google“ gegen einen nachgebauten OIDC-Anbieter: nur
// bestehende, aktive Konten mit bestätigter E-Mail kommen hinein.
describe('Anmelden über OIDC-Anbieter', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let email: string;
  const oidc = new FakeOidc();
  const api = () => request(app.getHttpServer());
  const saved = { ...process.env };

  beforeAll(async () => {
    await oidc.listen();
    Object.assign(process.env, {
      OIDC_ISSUER: oidc.issuer,
      OIDC_CLIENT_ID: oidc.clientId,
      OIDC_CLIENT_SECRET: oidc.clientSecret,
      OIDC_REDIRECT_URI: 'https://buero.test/api/auth/oidc/callback',
    });
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'OIDC GmbH');
    email = (await prisma.user.findUniqueOrThrow({ where: { id: company.userId } })).email;
  });

  afterAll(async () => {
    process.env = saved;
    await app.close();
    await oidc.close();
  });

  afterEach(() => {
    oidc.overrideClaims = {};
  });

  const stateCookie = (res: request.Response) =>
    (res.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('gartenai_oidc='))!
      .split(';')[0];

  async function start() {
    const res = await api().get('/auth/oidc/start').expect(302);
    return { location: res.headers.location as string, cookie: stateCookie(res) };
  }

  async function flow(identity: { email?: string; email_verified?: boolean }) {
    const { location, cookie } = await start();
    const { code, state } = oidc.authorize(location, identity);
    return api().get(`/auth/oidc/callback?code=${code}&state=${state}`).set('Cookie', cookie).expect(302);
  }

  it('meldet, dass die Anmeldung eingerichtet ist', async () => {
    const res = await api().get('/auth/oidc').expect(200);
    expect(res.body).toEqual({ enabled: true, label: 'Firmenkonto' });
  });

  it('leitet mit State, Nonce und PKCE zum Anbieter', async () => {
    const { location, cookie } = await start();
    const url = new URL(location);
    expect(url.origin + url.pathname).toBe(`${oidc.issuer}/authorize`);
    expect(url.searchParams.get('client_id')).toBe(oidc.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe('https://buero.test/api/auth/oidc/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toMatch(/^[\w-]{40,}$/);
    expect(url.searchParams.get('nonce')).toMatch(/^[\w-]{40,}$/);
    expect(cookie).toMatch(/^gartenai_oidc=/);
  });

  it('bestehendes Konto: Sitzung wird gesetzt, zurück ins Frontend', async () => {
    const res = await flow({ email: email.toUpperCase(), email_verified: true });
    expect(res.headers.location).toBe('https://buero.test/');
    const session = (res.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('gartenai_session='))!
      .split(';')[0];
    const me = await api().get('/auth/me').set('Cookie', session).expect(200);
    expect(me.body.id).toBe(company.userId);
  });

  it('unbekannte oder unbestätigte E-Mail und deaktivierte Konten kommen nicht hinein', async () => {
    let res = await flow({ email: 'fremd@example.com', email_verified: true });
    expect(res.headers.location).toBe('https://buero.test/login?sso=user');
    res = await flow({ email, email_verified: false });
    expect(res.headers.location).toBe('https://buero.test/login?sso=email');
    await prisma.user.update({ where: { id: company.userId }, data: { active: false } });
    res = await flow({ email, email_verified: true });
    expect(res.headers.location).toBe('https://buero.test/login?sso=user');
    await prisma.user.update({ where: { id: company.userId }, data: { active: true } });
  });

  it('State aus einem anderen Browser oder ohne Cookie wird abgelehnt', async () => {
    const first = await start();
    const second = await start();
    const { code, state } = oidc.authorize(first.location, { email, email_verified: true });
    let res = await api()
      .get(`/auth/oidc/callback?code=${code}&state=${state}`)
      .set('Cookie', second.cookie)
      .expect(302);
    expect(res.headers.location).toBe('https://buero.test/login?sso=state');
    res = await api().get(`/auth/oidc/callback?code=${code}&state=${state}`).expect(302);
    expect(res.headers.location).toBe('https://buero.test/login?sso=state');
  });

  it('gefälschtes oder fremdes ID-Token wird abgelehnt', async () => {
    const before = oidc.signingKey;
    oidc.signingKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    let res = await flow({ email, email_verified: true });
    expect(res.headers.location).toBe('https://buero.test/login?sso=token');
    oidc.signingKey = before;
    oidc.overrideClaims = { aud: 'andere-app' };
    res = await flow({ email, email_verified: true });
    expect(res.headers.location).toBe('https://buero.test/login?sso=token');
    oidc.overrideClaims = { nonce: 'falsch' };
    res = await flow({ email, email_verified: true });
    expect(res.headers.location).toBe('https://buero.test/login?sso=token');
  });

  it('nur freigegebene Domains, wenn OIDC_ALLOWED_DOMAINS gesetzt ist', async () => {
    process.env.OIDC_ALLOWED_DOMAINS = 'galabau-beispiel.de';
    try {
      const res = await flow({ email, email_verified: true });
      expect(res.headers.location).toBe('https://buero.test/login?sso=domain');
    } finally {
      delete process.env.OIDC_ALLOWED_DOMAINS;
    }
  });

  it('ohne Einstellungen ist die Anmeldung aus', async () => {
    delete process.env.OIDC_CLIENT_ID;
    try {
      await api().get('/auth/oidc').expect(200, { enabled: false });
      const res = await api().get('/auth/oidc/start').expect(302);
      expect(res.headers.location).toBe('/login?sso=config');
    } finally {
      process.env.OIDC_CLIENT_ID = oidc.clientId;
    }
  });
});
