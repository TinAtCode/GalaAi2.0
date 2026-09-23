import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

describe('Zeiteinträge korrigieren und freigeben', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let boss: TestCompany;
  let other: TestCompany;
  const api = () => request(app.getHttpServer());
  const as = (c: TestCompany) => ({ Authorization: `Bearer ${c.token}` });
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    boss = await createCompany(app, prisma, 'Zeit GmbH');
    other = await createCompany(app, prisma, 'Fremd GmbH');
  });

  afterAll(async () => {
    await app.close();
  });

  it('ein vergessenes "Stopp" wird mit Begründung korrigiert und protokolliert', async () => {
    const started = await api().post('/time-entries/start').set(as(boss)).send({}).expect(201);
    // Die Zeiterfassung lief "über Nacht": Beginn vor 20 Stunden
    await prisma.timeEntry.update({ where: { id: started.body.id }, data: { startTime: hoursAgo(20) } });

    await api()
      .patch(`/time-entries/${started.body.id}`)
      .set(as(boss))
      .send({ endTime: hoursAgo(11), breakMinutes: 30 })
      .expect(400); // Begründung fehlt

    const corrected = await api()
      .patch(`/time-entries/${started.body.id}`)
      .set(as(boss))
      .send({ endTime: hoursAgo(11), breakMinutes: 30, reason: 'Stopp vergessen, lt. Tagesbericht 9h' })
      .expect(200);
    expect(corrected.body.status).toBe('completed');

    const [log] = await prisma.auditLog.findMany({
      where: { entityId: started.body.id, action: 'time_entry_correct' },
    });
    expect(log.userId).toBe(boss.userId);
    expect(log.oldData).toMatchObject({ status: 'open', endTime: null });
    expect(log.newData).toMatchObject({ breakMinutes: 30, reason: 'Stopp vergessen, lt. Tagesbericht 9h' });
  });

  it('unplausible Korrekturen werden abgelehnt', async () => {
    const entry = await prisma.timeEntry.findFirstOrThrow({ where: { companyId: boss.companyId } });
    const patch = (body: object) =>
      api()
        .patch(`/time-entries/${entry.id}`)
        .set(as(boss))
        .send({ reason: 'Test', ...body });

    await patch({ endTime: hoursAgo(21) }).expect(400); // Ende vor Beginn
    await patch({ startTime: hoursAgo(40) }).expect(400); // mehr als 24 Stunden
    await patch({ breakMinutes: 1000 }).expect(400); // Pause länger als Arbeitszeit
    await patch({ endTime: new Date(Date.now() + 3600_000).toISOString() }).expect(400); // Zukunft
    await api()
      .patch(`/time-entries/${entry.id}`)
      .set(as(other))
      .send({ reason: 'Fremdzugriff', breakMinutes: 0 })
      .expect(404);
  });

  it('die Freigabe merkt sich, wer freigegeben hat, und sperrt den Eintrag', async () => {
    const entry = await prisma.timeEntry.findFirstOrThrow({ where: { companyId: boss.companyId } });
    await api().post(`/time-entries/${entry.id}/approve`).set(as(other)).expect(404);
    const approved = await api().post(`/time-entries/${entry.id}/approve`).set(as(boss)).expect(201);
    expect(approved.body).toMatchObject({ status: 'approved', approvedByUserId: boss.userId });
    expect(approved.body.approvedAt).toBeTruthy();
    expect(await prisma.auditLog.count({ where: { entityId: entry.id, action: 'time_entry_approve' } })).toBe(
      1,
    );

    await api().post(`/time-entries/${entry.id}/approve`).set(as(boss)).expect(400);
    await api()
      .patch(`/time-entries/${entry.id}`)
      .set(as(boss))
      .send({ breakMinutes: 0, reason: 'nachträglich' })
      .expect(400);
  });
});
