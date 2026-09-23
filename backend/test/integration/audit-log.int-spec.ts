import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// Protokoll lesen: nur mit audit.read, nur die eigene Firma, neueste zuerst,
// mit Namen der handelnden Person und Filtern.
describe('Audit-Log lesen', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  let projectId: string;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Protokoll GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    ({ projectId } = await createProject(app, company.token));
    await api().patch(`/projects/${projectId}/status`).set(auth).send({ status: 'in_progress' }).expect(200);
    await api().patch(`/projects/${projectId}/status`).set(auth).send({ status: 'done' }).expect(200);
    await prisma.auditLog.create({
      data: { companyId: company.companyId, action: 'price_import', entity: 'Article', source: 'import' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('neueste zuerst, mit Namen und Gesamtzahl', async () => {
    const res = await api().get('/audit-log?take=2').set(auth).expect(200);
    expect(res.headers['x-total-count']).toBe('3');
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ action: 'price_import', user: null, source: 'import' });
    expect(res.body[1]).toMatchObject({
      action: 'project_status',
      entity: 'Project',
      entityId: projectId,
      oldData: { status: 'in_progress' },
      newData: { status: 'done' },
      user: { id: company.userId, name: expect.any(String) },
    });
    expect(res.body[1].companyId).toBeUndefined();
  });

  it('filtert nach Objekt und Aktion', async () => {
    const byEntity = await api().get(`/audit-log?entityId=${projectId}`).set(auth).expect(200);
    expect(byEntity.body.map((e: { newData: { status: string } }) => e.newData.status)).toEqual([
      'done',
      'in_progress',
    ]);
    const byAction = await api().get('/audit-log?action=price_import').set(auth).expect(200);
    expect(byAction.body).toHaveLength(1);
  });

  it('ohne Recht audit.read: 403; andere Firmen sehen nichts', async () => {
    const auditRead = await prisma.permission.findUniqueOrThrow({ where: { key: 'audit.read' } });
    const other = await createCompany(app, prisma, 'Andere GmbH');
    const res = await api()
      .get('/audit-log')
      .set({ Authorization: `Bearer ${other.token}` })
      .expect(200);
    expect(res.body).toEqual([]);

    await prisma.rolePermission.deleteMany({ where: { permissionId: auditRead.id } });
    await api().get('/audit-log').set(auth).expect(403);
  });
});
