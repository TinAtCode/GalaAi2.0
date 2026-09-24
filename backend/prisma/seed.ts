import { PrismaClient } from '@prisma/client';
import { seedBase } from '../src/cli/base-seed';

// Beispieldaten für Entwicklung und E2E-Tests (Login: admin@musterbetrieb.de /
// demo12345). Die Demo mit mehr Daten: src/cli/demo-data.ts
const prisma = new PrismaClient();

seedBase(prisma)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
