import { PrismaClient } from '@prisma/client';
import { reportForDays } from '../metrics/metrics-history.service';
import { formatReport } from '../metrics/thresholds';

// Vorschläge für die Alarmschwellen aus dem gespeicherten Verlauf.
// Aufruf: node dist/cli/alert-thresholds.js [--days 28] [--json]
// (im Container: docker compose exec backend node dist/cli/alert-thresholds.js)
async function main() {
  const args = process.argv.slice(2);
  const daysIndex = args.indexOf('--days');
  const days = daysIndex >= 0 ? Number(args[daysIndex + 1]) : 28;
  const prisma = new PrismaClient();
  try {
    const report = await reportForDays(prisma, days);
    console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: Error) => {
    console.error(`Auswertung fehlgeschlagen: ${error.message}`);
    process.exit(1);
  });
}
