import { normalizeIban } from '../categorize';
import { EMPTY_DRAFT, PayableDraft } from './einvoice';
import { validIban } from './extract-text';

// Auftrag an die KI: nur JSON, feste Felder – damit die Antwort jedes
// Anbieters (auch kleiner, selbst gehosteter Modelle) auswertbar bleibt
export const AI_READ_PROMPT = [
  'Lies diese Eingangsrechnung eines Lieferanten.',
  'Antworte NUR mit einem JSON-Objekt mit genau diesen Feldern (unbekannt = null):',
  '{"supplierName": string, "invoiceNumber": string, "invoiceDate": "JJJJ-MM-TT", "dueDate": "JJJJ-MM-TT",',
  ' "amount": Zahl (zu zahlen, brutto), "netAmount": Zahl, "vatAmount": Zahl, "supplierIban": string,',
  ' "discountPercent": Zahl, "discountUntil": "JJJJ-MM-TT"}',
  'Beträge als Zahl mit Punkt, z.B. 1190.5. Die IBAN des Lieferanten, nicht die des Empfängers.',
].join('\n');

// erstes JSON-Objekt aus der Antwort (Modelle schreiben gern ```json … ``` drumherum)
export function jsonFromText(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

function amount(value: unknown, max = 99_999_999.99): string | null {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? n.toFixed(2) : null;
}

function day(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

// Antwort der KI in einen Vorschlag fürs Formular übersetzen. Alles wird
// geprüft; was nicht passt, bleibt leer – geraten wird nichts.
export function draftFromAi(raw: Record<string, unknown> | null, ownIbans: string[] = []): PayableDraft {
  if (!raw) return { ...EMPTY_DRAFT };
  const iban = normalizeIban(text(raw.supplierIban, 40));
  const own = new Set(ownIbans.map((i) => normalizeIban(i)));
  return {
    supplierName: text(raw.supplierName, 200),
    supplierIban: iban && validIban(iban) && !own.has(iban) ? iban : null,
    invoiceNumber: text(raw.invoiceNumber, 100),
    invoiceDate: day(raw.invoiceDate),
    dueDate: day(raw.dueDate),
    amount: amount(raw.amount),
    netAmount: amount(raw.netAmount),
    vatAmount: amount(raw.vatAmount),
    discountPercent: amount(raw.discountPercent, 100),
    discountUntil: day(raw.discountUntil),
  };
}
