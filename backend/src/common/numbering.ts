import { Prisma } from '@prisma/client';

// Nächste fortlaufende Belegnummer je Firma, Belegart und Jahr – atomar per
// INSERT ... ON CONFLICT: zwei gleichzeitige Angebote bekommen garantiert
// verschiedene Nummern. Muss in derselben Transaktion laufen wie das
// Anlegen des Belegs, damit bei einem Fehler keine Nummer verbraucht wird.
export async function nextSequenceValue(
  tx: Prisma.TransactionClient,
  companyId: string,
  kind: string,
  year: number,
): Promise<number> {
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "NumberSequence" ("companyId", "kind", "year", "lastValue")
    VALUES (${companyId}, ${kind}, ${year}, 1)
    ON CONFLICT ("companyId", "kind", "year")
    DO UPDATE SET "lastValue" = "NumberSequence"."lastValue" + 1
    RETURNING "lastValue"`;
  return rows[0].lastValue;
}

// z.B. formatDocumentNumber('A', 2026, 7) -> "A-2026-0007"
export function formatDocumentNumber(prefix: string, year: number, value: number) {
  return `${prefix}-${year}-${String(value).padStart(4, '0')}`;
}

// Kalenderjahr eines Zeitpunkts in der Zeitzone der Firma (Silvester-Nacht!).
export function yearInZone(instant: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(instant));
}
