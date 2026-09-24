import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// Baustelle: eigener Tag, Termin erledigen, Nachrichten und Fotos je Projekt,
// ungelesen, doppeltes Senden aus der Offline-Warteschlange, Rechte.
describe('Baustelle', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let office: TestCompany;
  let other: TestCompany;
  let projectId: string;
  let worker: { userId: string; auth: { Authorization: string } };
  const api = () => request(app.getHttpServer());
  const officeAuth = () => ({ Authorization: `Bearer ${office.token}` });
  // kleinstes gültiges PNG (1×1)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    office = await createCompany(app, prisma, 'Baustelle GmbH');
    other = await createCompany(app, prisma, 'Fremd Baustelle GmbH');
    ({ projectId } = await createProject(app, office.token));
    // Mitarbeiter mit den Rechten der Standardrolle (Kunden sehen, Baustelle)
    const role = await prisma.role.create({
      data: {
        companyId: office.companyId,
        name: 'Mitarbeiter',
        permissions: {
          create: (
            await prisma.permission.findMany({ where: { key: { in: ['customer.read', 'site.use'] } } })
          ).map((p) => ({ permissionId: p.id })),
        },
      },
    });
    const user = await prisma.user.create({
      data: {
        companyId: office.companyId,
        email: 'kai@baustelle.test',
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: 'Kai',
        lastName: 'Kelle',
        roles: { create: { roleId: role.id } },
        employee: { create: { companyId: office.companyId, firstName: 'Kai', lastName: 'Kelle' } },
      },
    });
    const login = await api()
      .post('/auth/login')
      .send({ email: 'kai@baustelle.test', password: 'test12345' });
    worker = { userId: user.id, auth: { Authorization: `Bearer ${login.body.accessToken}` } };
  });

  afterAll(async () => {
    await app.close();
  });

  it('zeigt den eigenen Tag und meldet Termine erledigt', async () => {
    // fester Tag statt „heute“ (sonst kippt der Test abends, wenn in Berlin schon morgen ist)
    const day9 = '2026-10-05T07:00:00.000Z'; // 9:00 Uhr in Berlin
    const mine = await api()
      .post('/appointments')
      .set(officeAuth())
      .send({
        projectId,
        title: 'Rasen mähen',
        startTime: day9,
        assignedUserId: worker.userId,
      })
      .expect(201);
    const notMine = await api()
      .post('/appointments')
      .set(officeAuth())
      .send({ projectId, title: 'Aufmaß', startTime: day9, assignedUserId: office.userId })
      .expect(201);

    await api().post('/time-entries/start').set(worker.auth).send({ projectId }).expect(201);
    const day = await api().get('/site/today?date=2026-10-05').set(worker.auth).expect(200);
    expect(day.body.appointments).toHaveLength(1);
    expect(day.body.appointments[0]).toMatchObject({
      id: mine.body.id,
      title: 'Rasen mähen',
      projectId,
      customer: 'Familie Muster',
      address: 'Köln',
      unread: 0,
    });
    expect(day.body.running).toMatchObject({ projectId });

    await api().post(`/site/appointments/${notMine.body.id}/done`).set(worker.auth).expect(404);
    await api().post(`/site/appointments/${mine.body.id}/done`).set(worker.auth).expect(201);
    await api().post(`/site/appointments/${mine.body.id}/done`).set(worker.auth).expect(404);
    const after = await api().get('/site/today?date=2026-10-05').set(worker.auth).expect(200);
    expect(after.body.appointments[0].status).toBe('done');
  });

  it('Nachrichten und Fotos zwischen Büro und Baustelle', async () => {
    await api()
      .post(`/site/projects/${projectId}/messages`)
      .set(officeAuth())
      .send({ text: 'Bitte Hecke hinten auch schneiden.' })
      .expect(201);
    let unread = await api().get('/site/unread').set(worker.auth).expect(200);
    expect(unread.body).toEqual([{ projectId, projectTitle: 'Terrasse anlegen', count: 1 }]);
    // eigene Nachrichten zählen nicht
    expect((await api().get('/site/unread').set(officeAuth()).expect(200)).body).toEqual([]);

    // Foto von der Baustelle, zweimal gesendet (Offline-Warteschlange) -> einmal gespeichert
    const send = () =>
      api()
        .post(`/site/projects/${projectId}/photos`)
        .set(worker.auth)
        .field('caption', 'Hecke fertig')
        .field('clientId', 'a1b2c3d4-0000-4000-8000-000000000001')
        .attach('file', png, { filename: 'hecke.png', contentType: 'image/png' })
        .expect(201);
    const first = await send();
    const second = await send();
    expect(second.body.id).toBe(first.body.id);
    expect(
      await prisma.document.count({ where: { companyId: office.companyId, documentType: 'photo' } }),
    ).toBe(1);

    await api()
      .post(`/site/projects/${projectId}/photos`)
      .set(worker.auth)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(400);

    const thread = await api().get(`/site/projects/${projectId}/messages`).set(officeAuth()).expect(200);
    expect(thread.body.messages.map((m: { text: string }) => m.text)).toEqual([
      'Bitte Hecke hinten auch schneiden.',
      'Hecke fertig',
    ]);
    expect(thread.body.messages[1].author).toMatchObject({ firstName: 'Kai' });
    const photo = await api()
      .get(`/site/photos/${first.body.documentId}`)
      .set(officeAuth())
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(photo.headers['content-type']).toBe('image/png');
    expect((photo.body as Buffer).equals(png)).toBe(true);
    // das Foto steht auch bei den Dokumenten des Projekts
    const docs = await api().get(`/documents/by-project/${projectId}`).set(officeAuth()).expect(200);
    expect(docs.body.map((d: { documentType: string }) => d.documentType)).toContain('photo');

    // gelesen
    await api().post(`/site/projects/${projectId}/read`).set(worker.auth).expect(201);
    unread = await api().get('/site/unread').set(worker.auth).expect(200);
    expect(unread.body).toEqual([]);
    expect((await api().get('/site/unread').set(officeAuth()).expect(200)).body[0].count).toBe(1);
  });

  it('Rechte und Mandanten', async () => {
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    await api().get(`/site/projects/${projectId}/messages`).set(otherAuth).expect(404);
    await api()
      .post(`/site/projects/${projectId}/messages`)
      .set(otherAuth)
      .send({ text: 'Hallo' })
      .expect(404);
    const message = await prisma.projectMessage.findFirstOrThrow({ where: { documentId: { not: null } } });
    await api().get(`/site/photos/${message.documentId}`).set(otherAuth).expect(404);
    // andere Dokumente sind über /site nicht erreichbar
    const doc = await api()
      .post(`/documents/upload?projectId=${projectId}`)
      .set(officeAuth())
      .attach('file', Buffer.from('geheim'), { filename: 'vertrag.txt', contentType: 'text/plain' })
      .expect(201);
    await api().get(`/site/photos/${doc.body.id}`).set(worker.auth).expect(404);
    // ohne site.use kein Zugang (z.B. Buchhaltung)
    const bookkeeping = await prisma.role.create({
      data: {
        companyId: office.companyId,
        name: 'Nur Kunden',
        permissions: {
          create: (await prisma.permission.findMany({ where: { key: 'customer.read' } })).map((p) => ({
            permissionId: p.id,
          })),
        },
      },
    });
    await prisma.user.create({
      data: {
        companyId: office.companyId,
        email: 'bh@baustelle.test',
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: 'Bea',
        lastName: 'Buch',
        roles: { create: { roleId: bookkeeping.id } },
      },
    });
    const login = await api().post('/auth/login').send({ email: 'bh@baustelle.test', password: 'test12345' });
    await api()
      .get('/site/today')
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .expect(403);
    await api()
      .post(`/site/projects/${projectId}/messages`)
      .set(worker.auth)
      .send({ text: '   ' })
      .expect(400);
  });
});
