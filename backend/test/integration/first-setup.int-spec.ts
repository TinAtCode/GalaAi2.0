import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, resetDatabase } from './helpers';

// Ersteinrichtung in der App: nur mit Einrichtungscode, nur solange es keinen
// Nutzer gibt, auch bei gleichzeitigen Versuchen nur einmal
describe('Ersteinrichtung in der App', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const input = (email: string) => ({
    code: 'ab12-cd34',
    companyName: 'Grün & Stein GmbH',
    email,
    password: 'ein-langes-passwort',
    firstName: 'Clara',
    lastName: 'Stein',
  });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    delete process.env.SETUP_CODE;
    await app.close();
  });

  it('ohne SETUP_CODE abgeschaltet', async () => {
    delete process.env.SETUP_CODE;
    expect((await api().get('/setup/status').expect(200)).body).toEqual({ needed: false });
    await api().post('/setup').send(input('a@gruen-stein.de')).expect(404);
  });

  it('mit Code genau einmal, auch bei gleichzeitigen Versuchen', async () => {
    process.env.SETUP_CODE = 'AB12-CD34';
    expect((await api().get('/setup/status').expect(200)).body).toEqual({ needed: true });
    const wrong = await api()
      .post('/setup')
      .send({ ...input('a@gruen-stein.de'), code: 'falsch' })
      .expect(403);
    expect(wrong.body.message).toContain('Einrichtungscode');
    await api()
      .post('/setup')
      .send({ ...input('a@gruen-stein.de'), password: 'kurz' })
      .expect(400);

    const [first, second] = await Promise.all([
      api().post('/setup').send(input('clara@gruen-stein.de')),
      api().post('/setup').send(input('zweite@gruen-stein.de')),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 403]);
    expect(await prisma.company.count({ where: { name: 'Grün & Stein GmbH' } })).toBe(1);

    const winner = first.status === 201 ? first.body.email : second.body.email;
    const login = await api()
      .post('/auth/login')
      .send({ email: winner, password: 'ein-langes-passwort' })
      .expect(201);
    expect(login.body.user.permissions).toContain('system.settings.write');

    expect((await api().get('/setup/status').expect(200)).body).toEqual({ needed: false });
    await api().post('/setup').send(input('dritte@gruen-stein.de')).expect(403);
  });
});
