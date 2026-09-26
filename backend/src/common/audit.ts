import { Prisma } from '@prisma/client';

// Änderungen an Preisen, Zeiten und Freigaben nachvollziehbar protokollieren:
// wer hat wann was von welchem Wert auf welchen geändert.
export function writeAudit(
  db: Prisma.TransactionClient,
  entry: {
    companyId: string;
    // null: vom System ausgelöst (z.B. automatischer Abgleich mit dem Kontoauszug)
    userId: string | null;
    action: string;
    entity: string;
    entityId: string;
    oldData?: Prisma.InputJsonValue;
    newData?: Prisma.InputJsonValue;
    source?: 'manual' | 'import' | 'ai' | 'system';
  },
) {
  return db.auditLog.create({ data: { source: 'manual', ...entry } });
}

// Nur die Felder, die sich wirklich ändern – für ein lesbares Audit-Log.
export function changedFields(before: Record<string, unknown>, patch: Record<string, unknown>) {
  const oldData: Record<string, Prisma.InputJsonValue> = {};
  const newData: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const previous = before[key];
    const prevComparable = previous instanceof Prisma.Decimal ? previous.toNumber() : previous;
    if (prevComparable !== value) {
      oldData[key] = prevComparable as Prisma.InputJsonValue;
      newData[key] = value as Prisma.InputJsonValue;
    }
  }
  return { oldData, newData, hasChanges: Object.keys(newData).length > 0 };
}
