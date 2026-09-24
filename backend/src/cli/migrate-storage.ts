import { PrismaClient } from '@prisma/client';
import { LocalDiskStorage } from '../documents/storage/local-disk.storage';
import { S3Storage, s3SettingsFromEnv } from '../documents/storage/s3.storage';

export interface MigrationResult {
  total: number;
  copied: number;
  skipped: number; // lag schon im Objektspeicher
  missing: string[]; // Datei fehlt lokal
  failed: { storagePath: string; error: string }[];
}

// Umzug der Dokumente vom Dateisystem in den Objektspeicher. Die Schlüssel
// sind dieselben Pfade (<companyId>/<datei>), Document.storagePath bleibt
// unverändert. Jede Datei wird nach dem Hochladen zurückgelesen und
// verglichen. Mehrfach aufrufbar: bereits vorhandene Dateien werden
// übersprungen. Lokale Dateien bleiben liegen (Sicherung).
export async function migrateStorage(
  prisma: PrismaClient,
  source: LocalDiskStorage,
  target: S3Storage,
  options: { dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<MigrationResult> {
  const log = options.log ?? (() => undefined);
  const documents = await prisma.document.findMany({
    select: { companyId: true, storagePath: true },
    distinct: ['companyId', 'storagePath'],
    orderBy: { createdAt: 'asc' },
  });
  const result: MigrationResult = { total: documents.length, copied: 0, skipped: 0, missing: [], failed: [] };
  for (const { companyId, storagePath } of documents) {
    try {
      if (await target.exists(companyId, storagePath)) {
        result.skipped++;
        continue;
      }
      let content: Buffer;
      try {
        content = await source.read(companyId, storagePath);
      } catch {
        result.missing.push(storagePath);
        log(`fehlt lokal: ${storagePath}`);
        continue;
      }
      if (options.dryRun) {
        result.copied++;
        continue;
      }
      await target.put(companyId, storagePath, content);
      const check = await target.read(companyId, storagePath);
      if (!check.equals(content)) throw new Error('Inhalt nach dem Hochladen verschieden');
      result.copied++;
      log(`kopiert: ${storagePath}`);
    } catch (error) {
      result.failed.push({ storagePath, error: (error as Error).message });
      log(`FEHLER ${storagePath}: ${(error as Error).message}`);
    }
  }
  return result;
}

// Aufruf: node dist/cli/migrate-storage.js [--dry-run]
// mit UPLOADS_DIR (Quelle) und den S3_*-Variablen (Ziel), siehe BETRIEB.md
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();
  try {
    const target = new S3Storage(s3SettingsFromEnv());
    await target.check();
    const result = await migrateStorage(prisma, new LocalDiskStorage(), target, {
      dryRun,
      log: (line) => console.log(line),
    });
    console.log(
      `${dryRun ? 'Probelauf: ' : ''}${result.total} Dateien, ${result.copied} ${dryRun ? 'zu kopieren' : 'kopiert'}, ${result.skipped} schon vorhanden, ${result.missing.length} fehlen lokal, ${result.failed.length} Fehler.`,
    );
    if (result.failed.length) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: Error) => {
    console.error(`Umzug fehlgeschlagen: ${error.message}`);
    process.exit(1);
  });
}
