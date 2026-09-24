import { PrismaClient } from '@prisma/client';
import { BOOKKEEPING_PERMISSIONS, EMPLOYEE_PERMISSIONS, PERMISSIONS } from '../common/permissions';
import { hashPassword, normalizeEmail, PASSWORD_MIN_LENGTH } from '../auth/passwords';

export interface SetupInput {
  companyName: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

// Ersteinrichtung für den Betrieb: Rechte, eigene Firma, Rollen
// "Geschäftsführung" (alle Rechte), "Buchhaltung" und "Mitarbeiter", erster Administrator
// mit Mitarbeiterprofil. Anders als der Seed (prisma/seed.ts) ohne
// Demo-Daten und ohne bekanntes Passwort. Alles in einer Transaktion.
export async function setupCompany(prisma: PrismaClient, input: SetupInput) {
  const companyName = input.companyName.trim();
  const email = normalizeEmail(input.email);
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!companyName || !firstName || !lastName) throw new Error('Firmenname, Vor- und Nachname sind Pflicht.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Ungültige E-Mail-Adresse: ${email}`);
  if (input.password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Das Passwort braucht mindestens ${PASSWORD_MIN_LENGTH} Zeichen.`);
  }
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email } })) {
      throw new Error(`Es gibt bereits einen Nutzer mit ${email}.`);
    }
    for (const key of Object.values(PERMISSIONS)) {
      await tx.permission.upsert({ where: { key }, update: {}, create: { key, label: key } });
    }
    const permissions = await tx.permission.findMany();
    const company = await tx.company.create({ data: { name: companyName } });
    const owner = await tx.role.create({
      data: {
        companyId: company.id,
        name: 'Geschäftsführung',
        isSystem: true,
        permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
      },
    });
    const employeeKeys: string[] = EMPLOYEE_PERMISSIONS;
    await tx.role.create({
      data: {
        companyId: company.id,
        name: 'Mitarbeiter',
        isSystem: true,
        permissions: {
          create: permissions
            .filter((p) => employeeKeys.includes(p.key))
            .map((p) => ({ permissionId: p.id })),
        },
      },
    });
    await tx.role.create({
      data: {
        companyId: company.id,
        name: 'Buchhaltung',
        isSystem: true,
        permissions: {
          create: permissions
            .filter((p) => (BOOKKEEPING_PERMISSIONS as string[]).includes(p.key))
            .map((p) => ({ permissionId: p.id })),
        },
      },
    });
    const user = await tx.user.create({
      data: {
        companyId: company.id,
        email,
        passwordHash,
        firstName,
        lastName,
        roles: { create: { roleId: owner.id } },
      },
    });
    await tx.employee.create({ data: { companyId: company.id, userId: user.id, firstName, lastName } });
    return { companyId: company.id, userId: user.id, email };
  });
}

// Aufruf: node dist/cli/setup-company.js (im Container: siehe README, Betrieb)
// mit SETUP_COMPANY_NAME, SETUP_ADMIN_EMAIL, SETUP_ADMIN_PASSWORD,
// SETUP_ADMIN_FIRST_NAME, SETUP_ADMIN_LAST_NAME.
async function main() {
  const env = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} fehlt.`);
    return value;
  };
  const prisma = new PrismaClient();
  try {
    const result = await setupCompany(prisma, {
      companyName: env('SETUP_COMPANY_NAME'),
      email: env('SETUP_ADMIN_EMAIL'),
      password: env('SETUP_ADMIN_PASSWORD'),
      firstName: env('SETUP_ADMIN_FIRST_NAME'),
      lastName: env('SETUP_ADMIN_LAST_NAME'),
    });
    console.log(`Firma angelegt (${result.companyId}); Anmeldung mit ${result.email}.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: Error) => {
    console.error(`Einrichtung fehlgeschlagen: ${error.message}`);
    process.exit(1);
  });
}
