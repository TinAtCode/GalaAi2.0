import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

// Checklisten: Einsatzplaner legt Vorlagen und Listen an, die Baustelle
// erweitert, hakt ab, kommentiert und schlägt Vorlagen vor
describe('Checklisten', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let other: TestCompany;
  let planner: { Authorization: string };
  let foreman: { Authorization: string };
  let projectId: string;
  const api = () => request(app.getHttpServer());

  const userWith = async (email: string, keys: string[], roleName: string) => {
    const role = await prisma.role.create({
      data: {
        companyId: company.companyId,
        name: roleName,
        permissions: {
          create: (await prisma.permission.findMany({ where: { key: { in: keys } } })).map((p) => ({
            permissionId: p.id,
          })),
        },
      },
    });
    await prisma.user.create({
      data: {
        companyId: company.companyId,
        email,
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: roleName,
        lastName: 'Test',
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api().post('/auth/login').send({ email, password: 'test12345' });
    return { Authorization: `Bearer ${login.body.accessToken}` };
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Liste GmbH');
    other = await createCompany(app, prisma, 'Andere GmbH');
    planner = await userWith('planer@liste.test', ['site.use', 'checklist.manage'], 'Einsatzplaner');
    foreman = await userWith('vorarbeiter@liste.test', ['site.use'], 'Vorarbeiter');
    const customer = await prisma.customer.create({ data: { companyId: company.companyId, name: 'Kunde' } });
    const property = await prisma.property.create({
      data: { companyId: company.companyId, customerId: customer.id, label: 'Garten' },
    });
    projectId = (
      await prisma.project.create({
        data: { companyId: company.companyId, propertyId: property.id, title: 'Pflaster' },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('Vorlage anlegen, Liste daraus, Baustelle erweitert und hakt ab', async () => {
    await api()
      .post('/checklist-templates')
      .set(foreman)
      .send({ title: 'Pflasterarbeiten', items: ['Leitungen geortet'] })
      .expect(403);
    const template = (
      await api()
        .post('/checklist-templates')
        .set(planner)
        .send({ title: 'Pflasterarbeiten', items: ['Leitungen geortet', ' Unterbau verdichtet ', ''] })
        .expect(201)
    ).body;
    expect(template).toMatchObject({
      status: 'approved',
      items: ['Leitungen geortet', 'Unterbau verdichtet'],
    });

    await api().post(`/projects/${projectId}/checklists`).set(foreman).send({ title: 'Start' }).expect(403);
    const list = (
      await api()
        .post(`/projects/${projectId}/checklists`)
        .set(planner)
        .send({ title: 'Pflaster Einfahrt', templateId: template.id })
        .expect(201)
    ).body;
    expect(list.items).toHaveLength(2);

    // Vorarbeiter: erweitern, abhaken, kommentieren – aber nicht umbenennen oder löschen
    const added = (
      await api()
        .post(`/checklists/${list.id}/items`)
        .set(foreman)
        .send({ text: 'Randsteine gesetzt' })
        .expect(201)
    ).body;
    expect(added.position).toBe(2);
    const first = list.items.find((i: { position: number }) => i.position === 0);
    await api().put(`/checklists/items/${first.id}`).set(foreman).send({ done: true }).expect(200);
    await api().put(`/checklists/items/${first.id}`).set(foreman).send({ text: 'anders' }).expect(403);
    await api().delete(`/checklists/items/${first.id}`).set(foreman).expect(403);
    await api()
      .post(`/checklists/${list.id}/comments`)
      .set(foreman)
      .send({ text: 'Gasleitung liegt tiefer als geplant', itemId: first.id })
      .expect(201);

    const view = (await api().get(`/projects/${projectId}/checklists`).set(foreman).expect(200)).body;
    expect(view.canManage).toBe(false);
    const [checklist] = view.checklists;
    expect(checklist.progress).toEqual({ done: 1, total: 3 });
    expect(
      checklist.items.map((i: { text: string; addedOnSite: boolean }) => [i.text, i.addedOnSite]),
    ).toEqual([
      ['Leitungen geortet', false],
      ['Unterbau verdichtet', false],
      ['Randsteine gesetzt', true],
    ]);
    expect(checklist.items[0].doneBy).toBe('Vorarbeiter Test');
    expect(checklist.comments[0]).toMatchObject({ itemId: first.id, user: 'Vorarbeiter Test' });

    // Einsatzplaner darf umbenennen und löschen
    await api()
      .put(`/checklists/items/${added.id}`)
      .set(planner)
      .send({ text: 'Randsteine in Beton' })
      .expect(200);
    await api().delete(`/checklists/items/${added.id}`).set(planner).expect(200);

    // andere Firma sieht nichts
    const foreign = { Authorization: `Bearer ${other.token}` };
    await api().get(`/projects/${projectId}/checklists`).set(foreign).expect(404);
    await api().post(`/checklists/${list.id}/items`).set(foreign).send({ text: 'x' }).expect(404);
  });

  it('Vorlage vorschlagen, Einsatzplaner prüft und gibt frei', async () => {
    const list = (
      await api()
        .post(`/projects/${projectId}/checklists`)
        .set(planner)
        .send({ title: 'Zaunbau' })
        .expect(201)
    ).body;
    await api()
      .post(`/checklists/${list.id}/items`)
      .set(foreman)
      .send({ text: 'Pfosten einbetoniert' })
      .expect(201);
    await api()
      .post(`/checklists/${list.id}/items`)
      .set(foreman)
      .send({ text: 'Felder montiert' })
      .expect(201);

    const proposal = (
      await api()
        .post(`/checklists/${list.id}/propose-template`)
        .set(foreman)
        .send({ title: 'Zaun' })
        .expect(201)
    ).body;
    expect(proposal.status).toBe('proposed');

    // Vorarbeiter sieht freigegebene und eigene Vorschläge; nicht verwendbar, bevor freigegeben
    const mine = (await api().get('/checklist-templates').set(foreman).expect(200)).body;
    expect(mine.templates.map((t: { title: string; status: string }) => [t.title, t.status])).toEqual([
      ['Zaun', 'proposed'],
      ['Pflasterarbeiten', 'approved'],
    ]);
    await api()
      .post(`/projects/${projectId}/checklists`)
      .set(planner)
      .send({ title: 'Zaun 2', templateId: proposal.id })
      .expect(400);
    await api()
      .post(`/checklist-templates/${proposal.id}/review`)
      .set(foreman)
      .send({ approve: true })
      .expect(403);

    const approved = (
      await api()
        .post(`/checklist-templates/${proposal.id}/review`)
        .set(planner)
        .send({
          approve: true,
          items: ['Pfosten einbetoniert', 'Felder montiert', 'Tor eingestellt'],
          note: 'ergänzt',
        })
        .expect(201)
    ).body;
    expect(approved).toMatchObject({ status: 'approved', reviewNote: 'ergänzt' });
    await api()
      .post(`/checklist-templates/${proposal.id}/review`)
      .set(planner)
      .send({ approve: false })
      .expect(400);
    const reused = (
      await api()
        .post(`/projects/${projectId}/checklists`)
        .set(planner)
        .send({ title: 'Zaun Nachbar', templateId: proposal.id })
        .expect(201)
    ).body;
    expect(reused.items).toHaveLength(3);

    const audit = await prisma.auditLog.findMany({
      where: { companyId: company.companyId, entity: 'ChecklistTemplate' },
    });
    expect(audit.map((a) => a.action)).toEqual(['checklist_template_approved']);
  });
});
