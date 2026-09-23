import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

describe('Benutzerverwaltung und Sitzungen', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: TestCompany;
  let other: TestCompany;
  let adminAuth: { Authorization: string };
  let officeRoleId: string;

  const api = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = (email: string, password: string) => api().post('/auth/login').send({ email, password });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    admin = await createCompany(app, prisma, 'Chef GmbH');
    other = await createCompany(app, prisma, 'Andere GmbH');
    adminAuth = bearer(admin.token);

    const role = await prisma.role.create({
      data: {
        companyId: admin.companyId,
        name: 'Büro',
        permissions: { create: [{ permission: { connect: { key: 'customer.read' } } }] },
      },
    });
    officeRoleId = role.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('ein Admin legt einen Nutzer an, der sich anmelden kann', async () => {
    const created = await api()
      .post('/users')
      .set(adminAuth)
      .send({
        email: 'Neu@Chef.test ',
        firstName: 'Nina',
        lastName: 'Neu',
        password: 'startpasswort1',
        roleIds: [officeRoleId],
        createEmployee: true,
      })
      .expect(201);
    expect(created.body.email).toBe('neu@chef.test');
    expect(created.body.passwordHash).toBeUndefined();
    expect(created.body.employee).not.toBeNull();

    const res = await login('NEU@chef.test', 'startpasswort1').expect(201);
    expect(res.body.user.permissions).toEqual(['customer.read']);
  });

  it('lehnt doppelte E-Mail, zu kurze Passwörter und fremde Rollen ab', async () => {
    const base = { firstName: 'X', lastName: 'Y', password: 'startpasswort1' };
    await api()
      .post('/users')
      .set(adminAuth)
      .send({ ...base, email: 'neu@chef.test' })
      .expect(409);
    await api()
      .post('/users')
      .set(adminAuth)
      .send({ ...base, email: 'kurz@chef.test', password: 'kurz' })
      .expect(400);
    const foreignRole = await prisma.role.findFirstOrThrow({ where: { companyId: other.companyId } });
    await api()
      .post('/users')
      .set(adminAuth)
      .send({ ...base, email: 'fremd@chef.test', roleIds: [foreignRole.id] })
      .expect(404);
  });

  it('Nutzer ohne Admin-Recht und fremde Firmen haben keinen Zugriff', async () => {
    const office = await login('neu@chef.test', 'startpasswort1').expect(201);
    await api().get('/users').set(bearer(office.body.accessToken)).expect(403);

    const list = await api().get('/users').set(bearer(other.token)).expect(200);
    expect(list.body.map((u: any) => u.email)).not.toContain('neu@chef.test');
    const nina = await prisma.user.findUniqueOrThrow({ where: { email: 'neu@chef.test' } });
    await api().patch(`/users/${nina.id}`).set(bearer(other.token)).send({ active: false }).expect(404);
  });

  it('Rechteänderungen wirken sofort, ohne neue Anmeldung', async () => {
    const office = await login('neu@chef.test', 'startpasswort1').expect(201);
    const token = office.body.accessToken;
    await api().get('/customers').set(bearer(token)).expect(200);

    await api()
      .patch(`/roles/${officeRoleId}/permissions`)
      .set(adminAuth)
      .send({ permissionKeys: [] })
      .expect(200);
    await api().get('/customers').set(bearer(token)).expect(403);
  });

  it('Deaktivieren meldet sofort ab; sich selbst deaktivieren geht nicht', async () => {
    const office = await login('neu@chef.test', 'startpasswort1').expect(201);
    const nina = await prisma.user.findUniqueOrThrow({ where: { email: 'neu@chef.test' } });

    await api().patch(`/users/${nina.id}`).set(adminAuth).send({ active: false }).expect(200);
    await api().get('/time-entries/mine').set(bearer(office.body.accessToken)).expect(401);
    await login('neu@chef.test', 'startpasswort1').expect(401);

    await api().patch(`/users/${admin.userId}`).set(adminAuth).send({ active: false }).expect(400);
    await api().patch(`/users/${nina.id}`).set(adminAuth).send({ active: true }).expect(200);
  });

  it('Passwort ändern: altes Passwort nötig, andere Sitzungen werden abgemeldet', async () => {
    const phone = await login('neu@chef.test', 'startpasswort1').expect(201);
    const laptop = await login('neu@chef.test', 'startpasswort1').expect(201);

    await api()
      .post('/auth/change-password')
      .set(bearer(laptop.body.accessToken))
      .send({ currentPassword: 'falsch-falsch', newPassword: 'neuespasswort2' })
      .expect(400);
    const changed = await api()
      .post('/auth/change-password')
      .set(bearer(laptop.body.accessToken))
      .send({ currentPassword: 'startpasswort1', newPassword: 'neuespasswort2' })
      .expect(201);

    await api().get('/time-entries/mine').set(bearer(phone.body.accessToken)).expect(401);
    await api().get('/time-entries/mine').set(bearer(changed.body.accessToken)).expect(200);
    await login('neu@chef.test', 'startpasswort1').expect(401);
    await login('neu@chef.test', 'neuespasswort2').expect(201);
  });

  it('ein Admin setzt ein vergessenes Passwort neu', async () => {
    const nina = await prisma.user.findUniqueOrThrow({ where: { email: 'neu@chef.test' } });
    await api()
      .post(`/users/${nina.id}/password`)
      .set(adminAuth)
      .send({ password: 'vomchefgesetzt3' })
      .expect(201);
    await login('neu@chef.test', 'vomchefgesetzt3').expect(201);
  });
});
