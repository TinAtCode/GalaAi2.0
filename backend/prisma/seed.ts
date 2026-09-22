import { PrismaClient, Permission } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PERMISSIONS } from '../src/common/permissions';

const prisma = new PrismaClient();

async function main() {
  // 1. Alle bekannten Permissions anlegen (idempotent)
  const permissionKeys = Object.values(PERMISSIONS);
  for (const key of permissionKeys) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, label: key },
    });
  }

  // 2. Beispiel-Unternehmen
  const company = await prisma.company.upsert({
    where: { id: 'demo-company-id' },
    update: {},
    create: { id: 'demo-company-id', name: 'Musterbetrieb GaLaBau GmbH' },
  });

  // 3. Rolle "Geschäftsführung" mit allen Rechten
  const allPermissions = await prisma.permission.findMany();
  const ownerRole = await prisma.role.upsert({
    where: { companyId_name: { companyId: company.id, name: 'Geschäftsführung' } },
    update: {},
    create: {
      companyId: company.id,
      name: 'Geschäftsführung',
      isSystem: true,
      permissions: {
        create: allPermissions.map((p: Permission) => ({ permissionId: p.id })),
      },
    },
  });

  // 4. Rolle "Mitarbeiter" mit eingeschränkten Rechten (keine Preise)
  const employeePermissions = allPermissions.filter((p: Permission) =>
    ([PERMISSIONS.CUSTOMER_READ, PERMISSIONS.AI_USE] as string[]).includes(p.key),
  );
  await prisma.role.upsert({
    where: { companyId_name: { companyId: company.id, name: 'Mitarbeiter' } },
    update: {},
    create: {
      companyId: company.id,
      name: 'Mitarbeiter',
      isSystem: true,
      permissions: {
        create: employeePermissions.map((p: Permission) => ({ permissionId: p.id })),
      },
    },
  });

  // 5. Admin-User (Login: admin@musterbetrieb.de / Passwort: demo12345)
  const passwordHash = await bcrypt.hash('demo12345', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@musterbetrieb.de' },
    update: {},
    create: {
      companyId: company.id,
      email: 'admin@musterbetrieb.de',
      passwordHash,
      firstName: 'Max',
      lastName: 'Mustermann',
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: ownerRole.id } },
    update: {},
    create: { userId: admin.id, roleId: ownerRole.id },
  });

  // Mitarbeiterprofil für den Admin-User, damit die Selbstbedienungs-
  // Zeiterfassung (POST /time-entries/start|stop) direkt testbar ist.
  await prisma.employee.upsert({
    where: { userId: admin.id },
    update: {},
    create: {
      companyId: company.id,
      userId: admin.id,
      firstName: admin.firstName,
      lastName: admin.lastName,
    },
  });

  // 6. Beispielkunde mit Objekt, Projekt, Artikel und Dienstleistung –
  // damit die komplette Kette Kunde→Objekt→Projekt→Angebot→Auftrag
  // direkt ausprobiert werden kann.
  await prisma.customer.upsert({
    where: { id: 'demo-customer-id' },
    update: {},
    create: {
      id: 'demo-customer-id',
      companyId: company.id,
      name: 'Familie Müller',
      email: 'mueller@example.com',
    },
  });

  const property = await prisma.property.upsert({
    where: { id: 'demo-property-id' },
    update: {},
    create: {
      id: 'demo-property-id',
      customerId: 'demo-customer-id',
      label: 'Hauptwohnsitz',
      street: 'Gartenweg 1',
      city: 'Musterstadt',
    },
  });

  await prisma.project.upsert({
    where: { id: 'demo-project-id' },
    update: {},
    create: {
      id: 'demo-project-id',
      propertyId: property.id,
      title: 'Terrassenbau Familie Müller',
    },
  });

  const schotter = await prisma.article.upsert({
    where: { companyId_articleNumber: { companyId: company.id, articleNumber: 'ART-001' } },
    update: {},
    create: {
      companyId: company.id,
      articleNumber: 'ART-001',
      name: 'Schotter 0/32',
      unit: 'Sack',
      purchasePrice: 3.5,
      salePrice: 6.0,
    },
  });

  const service = await prisma.service.upsert({
    where: { id: 'demo-service-id' },
    update: {},
    create: {
      id: 'demo-service-id',
      companyId: company.id,
      name: '1 m² Terrasse verlegen',
      unit: 'm2',
    },
  });

  await prisma.serviceComponent.upsert({
    where: { id: 'demo-component-material' },
    update: {},
    create: {
      id: 'demo-component-material',
      serviceId: service.id,
      articleId: schotter.id,
      quantityPer: 2,
    },
  });
  await prisma.serviceComponent.upsert({
    where: { id: 'demo-component-labor' },
    update: {},
    create: {
      id: 'demo-component-labor',
      serviceId: service.id,
      quantityPer: 0,
      laborMinutes: 20,
    },
  });

  // Beispieltermin für heute, damit GET /appointments/my-day sofort etwas
  // liefert (admin@musterbetrieb.de ist als assignedUser gesetzt).
  const today = new Date();
  today.setHours(8, 0, 0, 0);
  await prisma.appointment.upsert({
    where: { id: 'demo-appointment-id' },
    update: {},
    create: {
      id: 'demo-appointment-id',
      projectId: 'demo-project-id',
      title: 'Aufmaß nehmen',
      startTime: today,
      assignedUserId: admin.id,
    },
  });

  // Beispiel-Materialverbrauch, damit GET /post-calculation/:projectId auch
  // die Material-Seite (nicht nur Arbeitszeit) sofort etwas zeigt.
  await prisma.projectMaterialUsage.upsert({
    where: { id: 'demo-material-usage-id' },
    update: {},
    create: {
      id: 'demo-material-usage-id',
      projectId: 'demo-project-id',
      articleId: schotter.id,
      quantity: 18,
      recordedByUserId: admin.id,
    },
  });

  console.log('Seed abgeschlossen. Login: admin@musterbetrieb.de / demo12345');
  console.log(
    'Beispielkette bereit: demo-project-id -> POST /calculations {serviceId: "demo-service-id", quantity: 10} -> POST /quotes -> .../approve -> .../send -> .../outcome {status:"accepted"} -> POST /orders {quoteId} -> GET /post-calculation/demo-project-id',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
