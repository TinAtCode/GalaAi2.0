import { Prisma } from '@prisma/client';
import * as iconv from 'iconv-lite';
import { EXTF_COLUMNS, EXTF_NUMERIC_COLUMNS, ExtfColumn } from './extf-columns';

// Eine Buchung im Buchungsstapel. Beträge sind positiv; die Richtung steht im
// Soll/Haben-Kennzeichen (S = Soll auf „Konto“, H = Haben).
export interface ExtfBooking {
  amount: Prisma.Decimal;
  side: 'S' | 'H';
  account: number; // z.B. Debitor 10000
  contraAccount: number; // z.B. Erlöskonto 8400
  documentDate: string; // Belegdatum TTMM
  documentNumber: string; // Belegfeld 1, z.B. Rechnungsnummer
  text: string; // Buchungstext
  serviceDate?: string; // Leistungsdatum TTMMJJJJ
  dueDate?: string; // Fälligkeit TTMMJJJJ
}

export interface ExtfHeader {
  consultantNumber: number;
  clientNumber: number;
  fiscalYearStart: string; // JJJJMMTT
  from: string; // JJJJMMTT
  to: string; // JJJJMMTT
  chart: 'SKR03' | 'SKR04';
  label: string;
  createdAt: Date;
}

const quote = (text: string) => `"${text.replace(/"/g, '""')}"`;

// DATEV-Grenzen: Buchungstext 60 Zeichen, Belegfeld 1 36 Zeichen (nur
// Buchstaben, Ziffern und $ & % * + - /).
const clip = (text: string, max: number) => [...text.replace(/[\s;]+/g, ' ').trim()].slice(0, max).join('');
const documentField = (text: string) => text.replace(/[^A-Za-z0-9$&%*+\-/]/g, '').slice(0, 36);

// 1234.5 -> "1234,50" (ohne Tausenderpunkt)
const amount = (value: Prisma.Decimal) => value.toFixed(2).replace('.', ',');

// Erzeugt am: JJJJMMTThhmmssfff (UTC)
const timestamp = (at: Date) =>
  at
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 17);

function headerLine(h: ExtfHeader): string {
  const fields: (string | number | null)[] = [
    quote('EXTF'), // 1 Kennzeichen
    700, // 2 Versionsnummer
    21, // 3 Formatkategorie: Buchungsstapel
    quote('Buchungsstapel'), // 4 Formatname
    12, // 5 Formatversion
    timestamp(h.createdAt), // 6 erzeugt am
    null, // 7 importiert (reserviert)
    quote('RE'), // 8 Herkunft: Rechnungswesen
    quote('GartenAI'), // 9 exportiert von
    quote(''), // 10 importiert von
    h.consultantNumber, // 11 Beraternummer
    h.clientNumber, // 12 Mandantennummer
    h.fiscalYearStart, // 13 Beginn Wirtschaftsjahr
    4, // 14 Sachkontenlänge
    h.from, // 15 Datum vom
    h.to, // 16 Datum bis
    quote(clip(h.label, 30)), // 17 Bezeichnung
    quote(''), // 18 Diktatkürzel
    1, // 19 Buchungstyp: Finanzbuchführung
    0, // 20 Rechnungslegungszweck
    0, // 21 Festschreibung: nein, die Kanzlei kann noch bearbeiten
    quote('EUR'), // 22 Währung
    null, // 23 reserviert
    quote(''), // 24 Derivatskennzeichen
    null, // 25 reserviert
    null, // 26 reserviert
    quote(h.chart === 'SKR04' ? '04' : '03'), // 27 Sachkontenrahmen
    null, // 28 Branchenlösungs-Id
    null, // 29 reserviert
    quote(''), // 30 reserviert
    quote(''), // 31 Anwendungsinformation
  ];
  return fields.map((f) => (f === null ? '' : String(f))).join(';');
}

function bookingLine(b: ExtfBooking): string {
  const values: Partial<Record<ExtfColumn, string | number>> = {
    Umsatz: amount(b.amount),
    'Soll-/Haben-Kennzeichen': b.side,
    'WKZ Umsatz': 'EUR',
    Konto: b.account,
    'Gegenkonto (ohne BU-Schlüssel)': b.contraAccount,
    Belegdatum: b.documentDate,
    'Belegfeld 1': documentField(b.documentNumber),
    Buchungstext: clip(b.text, 60),
    Festschreibung: 0,
    ...(b.serviceDate ? { Leistungsdatum: b.serviceDate } : {}),
    ...(b.dueDate ? { Fälligkeit: b.dueDate } : {}),
  };
  return EXTF_COLUMNS.map((column) => {
    const value = values[column];
    if (EXTF_NUMERIC_COLUMNS.has(column)) return value === undefined ? '' : String(value);
    return quote(value === undefined ? '' : String(value));
  }).join(';');
}

// Buchungsstapel als Datei: Kopfzeile, Spaltenüberschriften, Buchungen.
// Windows-1252 mit CRLF – das liest jede DATEV-Version ein.
export function buildBuchungsstapel(header: ExtfHeader, bookings: ExtfBooking[]): Buffer {
  const lines = [headerLine(header), EXTF_COLUMNS.map(quote).join(';'), ...bookings.map(bookingLine)];
  return iconv.encode(lines.join('\r\n') + '\r\n', 'win1252');
}
