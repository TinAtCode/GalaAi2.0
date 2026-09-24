import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { PUSH_SENDER, PushSender, PushTarget } from '../../src/push/push-sender';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// Push-Nachrichten: Geräte an- und abmelden, Nachricht bei neuem oder
// verschobenem Termin und bei Baustellen-Nachrichten, abbestellte Geräte
// fallen raus. Der Push-Dienst des Browsers ist eine Attrappe.
describe('Push-Nachrichten', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let other: TestCompany;
  let office: { Authorization: string };
  let worker: { id: string; auth: { Authorization: string } };
  let projectId: string;
  const sent: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];
  const goneEndpoints = new Set<string>();
  const sender: PushSender = {
    async send(target: PushTarget, payload: string, vapid) {
      expect(vapid.privateKey).toBeTruthy();
      if (goneEndpoints.has(target.endpoint)) return { gone: true };
      sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) });
      return { gone: false };
    },
  };
  const api = () => request(app.getHttpServer());
  const device = (name: string) => ({
    endpoint: `https://push.example.com/send/${name}`,
    keys: { p256dh: `p256dh-${name}`, auth: `auth-${name}` },
  });
  // Versand läuft im Hintergrund: kurz warten, bis er angekommen ist
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
  };
  const inDays = (days: number, hour = 9) => {
    const d = new Date(Date.now() + days * 86_400_000);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PUSH_SENDER)
      .useValue(sender)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = new PrismaClient();
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Push GmbH');
    other = await createCompany(app, prisma, 'Fremd Push GmbH');
    office = { Authorization: `Bearer ${company.token}` };
    ({ projectId } = await createProject(app, company.token));
    const role = await prisma.role.create({
      data: {
        companyId: company.companyId,
        name: 'Baustelle',
        permissions: {
          create: (await prisma.permission.findMany({ where: { key: { in: ['site.use'] } } })).map((p) => ({
            permissionId: p.id,
          })),
        },
      },
    });
    const user = await prisma.user.create({
      data: {
        companyId: company.companyId,
        email: 'kai@push.test',
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: 'Kai',
        lastName: 'Kelle',
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api().post('/auth/login').send({ email: 'kai@push.test', password: 'test12345' });
    worker = { id: user.id, auth: { Authorization: `Bearer ${login.body.accessToken}` } };
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('Schlüssel des Servers: einmal erzeugt, verschlüsselt gespeichert', async () => {
    const first = await api().get('/push/public-key').set(worker.auth).expect(200);
    const second = await api().get('/push/public-key').set(office).expect(200);
    expect(first.body.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(second.body.publicKey).toBe(first.body.publicKey);
    const stored = await prisma.appSecret.findUniqueOrThrow({ where: { name: 'vapid' } });
    expect(stored.value).toMatch(/^v1:/);
    expect(stored.value).not.toContain(first.body.publicKey);
    await api().get('/push/public-key').expect(401);
  });

  it('Schlüssel nicht mehr lesbar: neue Schlüssel, alte Geräte verworfen', async () => {
    const before = (await api().get('/push/public-key').set(office).expect(200)).body.publicKey;
    await api().post('/push/subscribe').set(office).send(device('alt')).expect(201);
    await prisma.appSecret.update({ where: { name: 'vapid' }, data: { value: 'v1:AAAA:AAAA:AAAA' } });
    // eigener Dienst ohne zwischengespeicherte Schlüssel, wie nach einem Neustart
    const { PushService } = await import('../../src/push/push.service');
    const fresh = new PushService(app.get(PrismaService), sender);
    const after = (await fresh.publicKey()).publicKey;
    expect(after).not.toBe(before);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it('Termin zugeteilt oder verschoben: der Mitarbeiter bekommt Bescheid', async () => {
    await api().post('/push/subscribe').set(worker.auth).send(device('kai')).expect(201);
    await api()
      .post('/push/subscribe')
      .set(worker.auth)
      .send({ ...device('x'), endpoint: 'http://unsicher.example.com/x' })
      .expect(400);
    expect((await api().get('/push/status').set(worker.auth).expect(200)).body).toEqual({ devices: 1 });

    const created = await api()
      .post('/appointments')
      .set(office)
      .send({ projectId, title: 'Hecke schneiden', startTime: inDays(1), assignedUserId: worker.id })
      .expect(201);
    await until(() => sent.length >= 1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      endpoint: device('kai').endpoint,
      payload: { title: 'Neuer Termin', url: '/baustelle' },
    });
    expect(sent[0].payload.body).toContain('Hecke schneiden');

    await api()
      .patch(`/appointments/${created.body.id}`)
      .set(office)
      .send({ startTime: inDays(2) })
      .expect(200);
    await until(() => sent.length >= 2);
    expect(sent[1].payload.title).toBe('Termin geändert');

    // weit voraus und nicht zugeteilt: keine Nachricht
    await api()
      .post('/appointments')
      .set(office)
      .send({ projectId, title: 'Herbstschnitt', startTime: inDays(40), assignedUserId: worker.id })
      .expect(201);
    await api()
      .post('/appointments')
      .set(office)
      .send({ projectId, title: 'Offen', startTime: inDays(1, 14) })
      .expect(201);
    await new Promise((r) => setTimeout(r, 200));
    expect(sent).toHaveLength(2);
  });

  it('Baustellen-Nachrichten: an die Beteiligten, nie an den Absender', async () => {
    await api().post('/push/subscribe').set(office).send(device('buero')).expect(201);
    sent.length = 0;
    // Büro schreibt: der eingeplante Mitarbeiter bekommt Bescheid
    await api()
      .post(`/site/projects/${projectId}/messages`)
      .set(office)
      .send({ text: 'Material kommt um 7' })
      .expect(201);
    await until(() => sent.length >= 1);
    expect(sent.map((s) => s.endpoint)).toEqual([device('kai').endpoint]);
    expect(sent[0].payload).toMatchObject({
      body: 'Ada: Material kommt um 7',
      url: `/baustelle/${projectId}`,
    });
    // Mitarbeiter antwortet: das Büro (hat im Verlauf geschrieben) bekommt Bescheid
    sent.length = 0;
    await api()
      .post(`/site/projects/${projectId}/messages`)
      .set(worker.auth)
      .send({ text: 'Danke' })
      .expect(201);
    await until(() => sent.length >= 1);
    expect(sent.map((s) => s.endpoint)).toEqual([device('buero').endpoint]);
  });

  it('abbestellt, abgemeldet, anderes Gerät übernommen, Mandanten', async () => {
    // Gerät meldet „abbestellt“ (410): Eintrag verschwindet
    goneEndpoints.add(device('buero').endpoint);
    await api()
      .post(`/site/projects/${projectId}/messages`)
      .set(worker.auth)
      .send({ text: 'Noch was' })
      .expect(201);
    await new Promise((r) => setTimeout(r, 200));
    expect((await api().get('/push/status').set(office).expect(200)).body).toEqual({ devices: 0 });

    // Mitarbeiter meldet sein Gerät ab: keine Nachricht mehr
    await api()
      .delete('/push/subscribe')
      .set(worker.auth)
      .send({ endpoint: device('kai').endpoint })
      .expect(200);
    sent.length = 0;
    await api()
      .post('/appointments')
      .set(office)
      .send({ projectId, title: 'Mähen', startTime: inDays(3), assignedUserId: worker.id })
      .expect(201);
    await new Promise((r) => setTimeout(r, 200));
    expect(sent).toHaveLength(0);

    // dasselbe Handy, jetzt meldet sich jemand anderes an: gehört dann nur noch ihm
    await api().post('/push/subscribe').set(worker.auth).send(device('handy')).expect(201);
    await api().post('/push/subscribe').set(office).send(device('handy')).expect(201);
    expect((await api().get('/push/status').set(worker.auth).expect(200)).body).toEqual({ devices: 0 });

    // andere Firma: kann fremde Geräte nicht abmelden
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    await api()
      .delete('/push/subscribe')
      .set(otherAuth)
      .send({ endpoint: device('handy').endpoint })
      .expect(200);
    expect((await api().get('/push/status').set(office).expect(200)).body).toEqual({ devices: 1 });
  });
});
