import { normalizeName } from '../categorize';

// Rechtsform und Füllwörter zählen beim Vergleich von Firmennamen nicht:
// "Stein & Kies GmbH & Co. KG" = "Stein und Kies"
const NOISE = new Set([
  'gmbh',
  'mbh',
  'kg',
  'ag',
  'co',
  'ohg',
  'ug',
  'gbr',
  'ek',
  'e',
  'k',
  'und',
  'haftungsbeschränkt',
]);

export const supplierKey = (name: string | null) =>
  normalizeName(name)
    .split(' ')
    .filter((w) => w && !NOISE.has(w))
    .join(' ');

export interface SupplierCandidate {
  id: string;
  name: string;
  matchTerms: string[];
}

// Lieferant aus den Stammdaten zum Namen auf der Rechnung: gleicher Name
// (ohne Rechtsform) oder eines der Erkennungswörter des Lieferanten
export function findSupplier(name: string, suppliers: SupplierCandidate[]): string | null {
  const key = supplierKey(name);
  if (!key) return null;
  const byName = suppliers.filter((s) => supplierKey(s.name) === key);
  if (byName.length === 1) return byName[0].id;
  if (byName.length > 1) return null;
  const text = ` ${normalizeName(name)} `;
  const byTerm = suppliers.filter((s) =>
    s.matchTerms.some((t) => {
      const term = normalizeName(t);
      return term.length >= 3 && text.includes(` ${term} `);
    }),
  );
  return byTerm.length === 1 ? byTerm[0].id : null;
}

export interface NoteCandidate {
  id: string;
  noteNumber: string | null;
  noteDate: string | null; // YYYY-MM-DD
}

export type NoteReason = 'number' | 'date';

// nur Ziffern und Buchstaben: "LS-2026/0042" = "ls20260042"
const compact = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

const DAY_MS = 86_400_000;
// Lieferscheine bis zu vier Monate vor dem Rechnungsdatum (Sammelrechnungen)
export const NOTE_WINDOW_DAYS = 120;

// Vorschläge für die Lieferscheine einer Rechnung: Lieferscheinnummer im Text
// der Rechnung zuerst, dann nach Datum (neueste zuerst). Lieferscheine nach
// dem Rechnungsdatum oder weit davor fallen heraus.
export function rankNotes(
  invoice: { invoiceDate: string | null; text: string },
  notes: NoteCandidate[],
): (NoteCandidate & { reasons: NoteReason[] })[] {
  const text = compact(invoice.text);
  const invoiceTime = invoice.invoiceDate ? Date.parse(`${invoice.invoiceDate}T00:00:00Z`) : null;
  return notes
    .map((note) => {
      const reasons: NoteReason[] = [];
      const number = note.noteNumber ? compact(note.noteNumber) : '';
      if (number.length >= 3 && text.includes(number)) reasons.push('number');
      let inWindow = true;
      if (invoiceTime !== null && note.noteDate) {
        const days = (invoiceTime - Date.parse(`${note.noteDate}T00:00:00Z`)) / DAY_MS;
        inWindow = days >= 0 && days <= NOTE_WINDOW_DAYS;
        if (inWindow) reasons.push('date');
      }
      return { ...note, reasons, inWindow };
    })
    .filter((n) => n.reasons.includes('number') || n.inWindow)
    .sort(
      (a, b) =>
        Number(b.reasons.includes('number')) - Number(a.reasons.includes('number')) ||
        (b.noteDate ?? '').localeCompare(a.noteDate ?? ''),
    )
    .map(({ inWindow: _inWindow, ...note }) => note);
}
