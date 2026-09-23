import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { setupCompany } from '../../src/cli/setup-company';
import { BOOKKEEPING_PERMISSIONS, PERMISSIONS } from '../../src/common/permissions';
import { createApp, resetDatabase } from './helpers';

// Ersteinrichtung für den Betrieb (node dist/cli/setup-company.js)
describe('Ersteinrichtung: Firma und erster Administrator', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const input = {
    companyName: 'Grün & Stein GmbH',
    email: ' Chefin@Gruen-Stein.de ',
    password: 'ein-langes-passwort',
    firstName: 'Clara',
    lastName: 'Stein',
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    await prisma.permission.deleteMany(); // frische Datenbank: noch keine Rechte
  });

  afterAll(async () => {
    await app.close();
  });

  it('legt Rechte, Firma, Rollen und Admin an; Anmeldung mit allen Rechten', async () => {
    const result = await setupCompany(prisma, input);
    expect(result.email).toBe('chefin@gruen-stein.de');
    expect(await prisma.permission.count()).toBe(Object.values(PERMISSIONS).length);
    const roles = await prisma.role.findMany({
      where: { companyId: result.companyId },
      include: { permissions: true },
      orderBy: { name: 'asc' },
    });
    expect(roles.map((r) => [r.name, r.permissions.length])).toEqual([
      ['Buchhaltung', BOOKKEEPING_PERMISSIONS.length],
      ['Geschäftsführung', Object.values(PERMISSIONS).length],
      ['Mitarbeiter', 2],
    ]);
    expect(await prisma.employee.count({ where: { userId: result.userId } })).toBe(1);
    // keine Demo-Daten
    expect(await prisma.customer.count()).toBe(0);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'chefin@gruen-stein.de', password: input.password })
      .expect(201);
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .expect(200);
    expect(me.body.permissions).toEqual(expect.arrayContaining(Object.values(PERMISSIONS)));
  });

  it('lehnt doppelte E-Mail, kurzes Passwort und fehlende Angaben ab – ohne Teilanlage', async () => {
    const companies = await prisma.company.count();
    await expect(setupCompany(prisma, { ...input, companyName: 'Zweite GmbH' })).rejects.toThrow(/bereits/);
    await expect(setupCompany(prisma, { ...input, email: 'neu@x.de', password: 'kurz' })).rejects.toThrow(
      /mindestens/,
    );
    await expect(setupCompany(prisma, { ...input, email: 'neu@x.de', lastName: ' ' })).rejects.toThrow(
      /Pflicht/,
    );
    expect(await prisma.company.count()).toBe(companies);
  });
});
