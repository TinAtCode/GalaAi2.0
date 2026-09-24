import { BadRequestException } from '@nestjs/common';
import * as Papa from 'papaparse';
import { CamtEntry, CamtStatement } from './camt053';
import { parseAmount, parseDay, withDedupeKeys } from './statement-keys';

// Kontoauszug als CSV aus dem Online-Banking (Sparkasse, Volksbank, DKB,
// Commerzbank, Postbank …). Die Spalten heißen je Bank anders; erkannt werden
// sie über ihre Überschrift. Vorspann-Zeilen vor der Überschrift (Kontodaten)
// werden übersprungen. Vorgemerkte Umsätze und Fremdwährung zählen nicht.

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');

// Kandidaten je Feld (normalisierte Überschrift, erste passende gewinnt)
const COLUMNS = {
  date: ['buchungstag', 'buchungsdatum', 'buchung', 'datum', 'valutadatum', 'wertstellung', 'valuta'],
  amount: ['betrag', 'betrageur', 'umsatz', 'umsatzineur', 'betraginieur', 'amount'],
  debit: ['soll', 'sollbetrag', 'ausgang', 'belastung'],
  credit: ['haben', 'habenbetrag', 'eingang', 'gutschrift'],
  // Gegenpartei in einer Spalte …
  name: [
    'beguenstigterzahlungspflichtiger',
    'namezahlungsbeteiligter',
    'auftraggeberbeguenstigter',
    'auftraggeberempfaenger',
    'name',
    'gegenkonto',
  ],
  // … oder getrennt nach Zahler (bei Eingängen) und Empfänger (bei Ausgängen)
  payer: ['zahlungspflichtiger', 'zahlungspflichtigerin', 'zahlungspflichtiger', 'auftraggeber', 'absender'],
  payee: ['zahlungsempfaengerin', 'zahlungsempfaenger', 'empfaenger', 'beguenstigter'],
  iban: ['ibanzahlungsbeteiligter', 'kontonummeriban', 'iban', 'kontonummer', 'gegenkontoiban'],
  remittance: ['verwendungszweck', 'buchungsdetails', 'zweck', 'beschreibung', 'text'],
  account: ['auftragskonto', 'ibanauftragskonto', 'eigenekontonummer', 'konto'],
  currency: ['waehrung', 'wahrung', 'currency'],
  info: ['info', 'status'],
} as const;

type Key = keyof typeof COLUMNS;

function mapHeader(row: string[]): Partial<Record<Key, number>> | null {
  const cells = row.map(norm);
  const map: Partial<Record<Key, number>> = {};
  for (const key of Object.keys(COLUMNS) as Key[]) {
    for (const candidate of COLUMNS[key]) {
      const index = cells.findIndex((c, i) => c === candidate && !Object.values(map).includes(i));
      if (index >= 0) {
        map[key] = index;
        break;
      }
    }
  }
  const hasAmount = map.amount !== undefined || (map.debit !== undefined && map.credit !== undefined);
  return map.date !== undefined && hasAmount ? map : null;
}

export function parseBankCsv(text: string): CamtStatement {
  const parsed = Papa.parse<string[]>(text.trim(), { skipEmptyLines: 'greedy' });
  const rows = parsed.data.filter((r) => Array.isArray(r) && r.some((c) => c.trim()));
  const headerIndex = rows.findIndex((r) => mapHeader(r) !== null);
  if (headerIndex < 0) {
    throw new BadRequestException(
      'In der CSV-Datei wurden keine Spalten für Buchungstag und Betrag gefunden (z. B. „Buchungstag“ und „Betrag“).',
    );
  }
  const map = mapHeader(rows[headerIndex])!;
  // Kontonummer aus dem Vorspann (z. B. "Konto:;DE12 …" bei DKB)
  const preamble = rows
    .slice(0, headerIndex)
    .flat()
    .map((c) => c.replace(/\s/g, ''))
    .find((c) => /^[A-Z]{2}\d{2}[A-Z0-9]{12,30}$/.test(c));

  const cell = (row: string[], key: Key) => (map[key] === undefined ? '' : (row[map[key]!] ?? '').trim());
  const entries: Omit<CamtEntry, 'dedupeKey'>[] = [];
  const skipped = { notBooked: 0, foreignCurrency: 0 };

  rows.slice(headerIndex + 1).forEach((row, index) => {
    const line = headerIndex + index + 2;
    if (/vorgemerkt|vormerkung|pending/i.test(cell(row, 'info'))) {
      skipped.notBooked++;
      return;
    }
    const currency = cell(row, 'currency').toUpperCase();
    if (currency && currency !== 'EUR' && currency !== '€') {
      skipped.foreignCurrency++;
      return;
    }
    const bookingDate = parseDay(cell(row, 'date'));
    let value: number | null;
    if (map.amount !== undefined) value = parseAmount(cell(row, 'amount'));
    else {
      const debit = parseAmount(cell(row, 'debit')) ?? 0;
      const credit = parseAmount(cell(row, 'credit')) ?? 0;
      value = credit - Math.abs(debit);
    }
    if (!bookingDate || value === null) {
      // Summen- oder Fußzeilen ohne Datum überspringen, echte Fehler melden
      if (!cell(row, 'date')) return;
      throw new BadRequestException(`Zeile ${line} der CSV-Datei: Datum oder Betrag nicht lesbar.`);
    }
    if (value === 0) return;
    const iban = cell(row, 'iban').replace(/\s/g, '').toUpperCase();
    const account = cell(row, 'account').replace(/\s/g, '').toUpperCase() || preamble || null;
    entries.push({
      direction: value > 0 ? 'credit' : 'debit',
      reversal: false,
      accountIban: account,
      bookingDate,
      amount: Math.abs(value).toFixed(2),
      counterpartyName: cell(row, 'name') || cell(row, value > 0 ? 'payer' : 'payee') || null,
      counterpartyIban: /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban) ? iban : null,
      remittance: cell(row, 'remittance').replace(/\s+/g, ' ') || null,
    });
  });
  if (!entries.length && !skipped.notBooked && !skipped.foreignCurrency) {
    throw new BadRequestException('Die CSV-Datei enthält keine Umsätze.');
  }
  return { entries: withDedupeKeys('csv', entries), balances: [], skipped };
}
