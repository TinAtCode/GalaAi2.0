import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createApp, createCompany, resetDatabase } from './helpers';

// Login-Grenzen mit niedrigen Testwerten: 3 Versuche je Konto, 6 je IP.
describe('Login-Rate-Limit', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const saved = { account: process.env.LOGIN_RATE_LIMIT, ip: process.env.LOGIN_IP_RATE_LIMIT };

  const login = (email: string) =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password: 'falsch123' });

  beforeAll(async () => {
    const setup = await createApp();
    await resetDatabase(setup.prisma);
    await createCompany(setup.app, setup.prisma, 'Konto A');
    await createCompany(setup.app, setup.prisma, 'Konto B');
    await setup.app.close();

    // Frische App = frischer Zähler, die Logins aus dem Setup zählen nicht mit.
    process.env.LOGIN_RATE_LIMIT = '3';
    process.env.LOGIN_IP_RATE_LIMIT = '6';
    ({ app, prisma } = await createApp());
  });

  afterAll(async () => {
    process.env.LOGIN_RATE_LIMIT = saved.account;
    process.env.LOGIN_IP_RATE_LIMIT = saved.ip;
    await app.close();
    await prisma.$disconnect();
  });

  it('sperrt ein Konto nach zu vielen Fehlversuchen, andere Konten derselben IP bleiben offen', async () => {
    for (let i = 0; i < 3; i++) await login('admin@kontoa.test').expect(401);
    await login('admin@kontoa.test').expect(429);
    await login('ADMIN@kontoa.test ').expect(429); // Groß-/Kleinschreibung und Leerzeichen zählen nicht als neues Konto

    // Früher zählte nur die IP: der Kollege im selben WLAN wäre jetzt auch gesperrt.
    await login('admin@kontob.test').expect(401);
  });

  it('bremst das Durchprobieren vieler Konten von einer IP', async () => {
    // Bisher 6 Login-Anfragen von dieser IP, das IP-Limit ist erreicht.
    await login('jemand@anderes.test').expect(429);
  });

  it('andere Endpunkte sind davon nicht betroffen', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
  });
});
