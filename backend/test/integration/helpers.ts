import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { PERMISSIONS } from '../../src/common/permissions';
import { PrismaService } from '../../src/prisma/prisma.service';

export async function createApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

// Leert alle Tabellen außer der Migrationshistorie.
export async function resetDatabase(prisma: PrismaService) {
  const tables: { tablename: string }[] = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);

  for (const key of Object.values(PERMISSIONS)) {
    await prisma.permission.create({ data: { key, label: key } });
  }
}

export interface TestCompany {
  companyId: string;
  userId: string;
  employeeId: string;
  token: string;
}

// Legt eine Firma mit einem Admin (alle Rechte, mit Mitarbeiterprofil) an und
// meldet ihn über den echten Login-Endpunkt an.
export async function createCompany(
  app: INestApplication,
  prisma: PrismaService,
  name: string,
): Promise<TestCompany> {
  const company = await prisma.company.create({ data: { name } });
  const permissions = await prisma.permission.findMany();
  const role = await prisma.role.create({
    data: {
      companyId: company.id,
      name: 'Admin',
      permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
    },
  });
  const email = `admin@${name.toLowerCase().replace(/\W/g, '')}.test`;
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      email,
      passwordHash: await bcrypt.hash('test12345', 4),
      firstName: 'Ada',
      lastName: name,
      roles: { create: { roleId: role.id } },
    },
  });
  const employee = await prisma.employee.create({
    data: { companyId: company.id, userId: user.id, firstName: 'Ada', lastName: name },
  });

  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: 'test12345' })
    .expect(201);

  return { companyId: company.id, userId: user.id, employeeId: employee.id, token: res.body.accessToken };
}

// Kunde -> Objekt -> Projekt über die echte API anlegen.
export async function createProject(app: INestApplication, token: string) {
  const api = request(app.getHttpServer());
  const auth = { Authorization: `Bearer ${token}` };
  const customer = await api.post('/customers').set(auth).send({ name: 'Familie Muster' }).expect(201);
  const property = await api
    .post('/properties')
    .set(auth)
    .send({ customerId: customer.body.id, label: 'Garten', city: 'Köln' })
    .expect(201);
  const project = await api
    .post('/projects')
    .set(auth)
    .send({ propertyId: property.body.id, title: 'Terrasse anlegen' })
    .expect(201);
  return { customerId: customer.body.id, propertyId: property.body.id, projectId: project.body.id };
}

// PDF herunterladen und den Text extrahieren (für inhaltliche Prüfungen).
export async function fetchPdfText(app: INestApplication, path: string, token: string) {
  const res = await request(app.getHttpServer())
    .get(path)
    .set({ Authorization: `Bearer ${token}` })
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  const body = res.body as Buffer;
  let text = '';
  if (res.status === 200) {
    const { PDFParse } = await import('pdf-parse');
    text = (await new PDFParse({ data: body }).getText()).text;
  }
  return {
    status: res.status,
    contentType: res.headers['content-type'],
    text,
    isPdf: body.subarray(0, 4).toString() === '%PDF',
  };
}
