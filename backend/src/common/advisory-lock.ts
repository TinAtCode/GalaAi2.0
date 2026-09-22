import { Prisma } from '@prisma/client';

// Serialisiert "erst prüfen, dann schreiben"-Abläufe pro Schlüssel (z.B. pro
// Mitarbeiter) über eine PostgreSQL-Transaktionssperre. Ohne das könnten zwei
// fast gleichzeitige Anfragen beide die Prüfung bestehen – etwa zwei laufende
// Zeiterfassungen oder zwei überlappende Termine für dieselbe Person.
// Die Sperre gilt bis zum Ende der Transaktion und blockiert nur Anfragen mit
// demselben Schlüssel.
export async function lockFor(tx: Prisma.TransactionClient, scope: string, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}), hashtext(${key}))`;
}
