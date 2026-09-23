import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// Die Datenbank selbst verhindert Verknüpfungen über Firmengrenzen hinweg
// (Trigger tenant_guard) – auch für Schreibzugriffe, die an den Services
// vorbeigehen. Hier deshalb bewusst direkt über Prisma.
describe('Mandantentrennung in der Datenbank', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let a: TestCompany;
  let b: TestCompany;
  let projectA: string;
  let projectB: string;
  const rejected = /Mandantenfremde Verknüpfung/;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    a = await createCompany(app, prisma, 'Firma A');
    b = await createCompany(app, prisma, 'Firma B');
    projectA = (await createProject(app, a.token)).projectId;
    projectB = (await createProject(app, b.token)).projectId;
  });

  afterAll(async () => {
    await app.close();
  });

  const quoteData = (companyId: string, projectId: string) => ({
    companyId,
    projectId,
    totalNet: 0,
  });

  it('kein Angebot für das Projekt einer anderen Firma', async () => {
    await expect(prisma.quote.create({ data: quoteData(a.companyId, projectB) })).rejects.toThrow(rejected);
    await expect(prisma.quote.create({ data: quoteData(a.companyId, projectA) })).resolves.toBeDefined();
  });

  it('auch nicht nachträglich per Update', async () => {
    const quote = await prisma.quote.create({ data: quoteData(a.companyId, projectA) });
    await expect(
      prisma.quote.update({ where: { id: quote.id }, data: { projectId: projectB } }),
    ).rejects.toThrow(rejected);
    const property = await prisma.property.findFirstOrThrow({ where: { companyId: a.companyId } });
    const foreignCustomer = await prisma.customer.findFirstOrThrow({ where: { companyId: b.companyId } });
    await expect(
      prisma.property.update({ where: { id: property.id }, data: { customerId: foreignCustomer.id } }),
    ).rejects.toThrow(rejected);
  });

  it('Tabellen ohne eigene companyId: Rollen und Rezepturen', async () => {
    const roleB = await prisma.role.create({ data: { companyId: b.companyId, name: 'Fremd' } });
    await expect(prisma.userRole.create({ data: { userId: a.userId, roleId: roleB.id } })).rejects.toThrow(
      rejected,
    );

    const service = await prisma.service.create({
      data: { companyId: a.companyId, name: 'Rasen', unit: 'm2' },
    });
    const articleB = await prisma.article.create({
      data: {
        companyId: b.companyId,
        articleNumber: 'B-1',
        name: 'Fremdes Saatgut',
        unit: 'kg',
        purchasePrice: 1,
        salePrice: 2,
      },
    });
    await expect(
      prisma.serviceComponent.create({
        data: { serviceId: service.id, articleId: articleB.id, quantityPer: 1 },
      }),
    ).rejects.toThrow(rejected);
  });

  it('Zeiterfassung und Termine nur mit eigenen Mitarbeitern und Projekten', async () => {
    await expect(
      prisma.timeEntry.create({
        data: {
          companyId: a.companyId,
          employeeId: b.employeeId,
          projectId: projectA,
          startTime: new Date(),
        },
      }),
    ).rejects.toThrow(rejected);
    await expect(
      prisma.appointment.create({
        data: {
          companyId: a.companyId,
          projectId: projectA,
          assignedUserId: b.userId,
          title: 'Fremder Termin',
          startTime: new Date(),
          endTime: new Date(Date.now() + 3600_000),
        },
      }),
    ).rejects.toThrow(rejected);
  });

  it('die App fragt Mandanten-Tabellen nie ohne companyId ab – auch nicht in Transaktionen', async () => {
    const appPrisma = app.get(PrismaService);
    await expect(appPrisma.customer.findMany()).rejects.toThrow(/ohne companyId-Filter/);
    await expect(appPrisma.invoice.count({ where: { status: 'draft' } })).rejects.toThrow(
      /ohne companyId-Filter/,
    );
    await expect(
      appPrisma.$transaction((tx) => tx.project.updateMany({ where: { title: 'x' }, data: { title: 'y' } })),
    ).rejects.toThrow(/ohne companyId-Filter/);
    await expect(appPrisma.customer.findMany({ where: { companyId: a.companyId } })).resolves.toHaveLength(1);
  });
});
