import { createHash } from 'crypto';
import { CamtEntry } from './camt053';

// Schlüssel gegen doppeltes Einlesen für Formate ohne eindeutige Bankreferenz
// (MT940, CSV): aus den Merkmalen des Umsatzes plus laufender Nummer unter
// gleichen Umsätzen. Derselbe Auszug – auch überlappend erneut exportiert –
// ergibt dieselben Schlüssel; zwei gleiche Überweisungen am selben Tag
// bleiben zwei Umsätze.
export function withDedupeKeys(
  format: 'mt940' | 'csv',
  entries: Omit<CamtEntry, 'dedupeKey'>[],
): CamtEntry[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const base = [
      entry.accountIban ?? '',
      entry.bookingDate,
      entry.direction,
      entry.reversal ? 'R' : '',
      entry.amount,
      entry.counterpartyIban ?? '',
      (entry.counterpartyName ?? '').toLowerCase(),
      (entry.remittance ?? '').replace(/\s+/g, ' ').toLowerCase(),
    ].join('|');
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    const hash = createHash('sha256').update(`${base}|${occurrence}`).digest('hex').slice(0, 40);
    return { ...entry, dedupeKey: `${entry.accountIban ?? ''}|${format}:${hash}` };
  });
}

// Text einer Datei: UTF-8, sonst (typisch bei Bankexporten) Windows-1252/Latin-1
export function decodeText(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (!utf8.includes('\uFFFD')) return utf8;
  return new TextDecoder('windows-1252').decode(buffer);
}

// Betrag in deutscher oder technischer Schreibweise: "1.234,56", "-12,3", "1234.56"
export function parseAmount(raw: string): number | null {
  let value = raw.trim().replace(/\s|€|EUR/gi, '');
  if (!value) return null;
  const negative = /^-|-$/.test(value) || /^\(.*\)$/.test(value);
  value = value.replace(/^[-+(]|[-+)]$/g, '');
  if (value.includes(',')) value = value.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(value)) value = value.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? (negative ? -amount : amount) : null;
}

// Datum TT.MM.JJJJ, TT.MM.JJ oder JJJJ-MM-TT -> JJJJ-MM-TT
export function parseDay(raw: string): string | null {
  const value = raw.trim();
  let match = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(value);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return valid(`${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`);
  }
  match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? valid(`${match[1]}-${match[2]}-${match[3]}`) : null;
}

function valid(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
}
