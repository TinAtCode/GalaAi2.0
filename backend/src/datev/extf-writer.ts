import { Prisma } from '@prisma/client';
import * as iconv from 'iconv-lite';
import {
  DEBTOR_COLUMNS,
  DEBTOR_NUMERIC_COLUMNS,
  DebtorColumn,
  EXTF_COLUMNS,
  EXTF_NUMERIC_COLUMNS,
  ExtfColumn,
} from './extf-columns';

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

function headerLine(h: ExtfHeader, format: 'bookings' | 'debtors' = 'bookings'): string {
  const bookings = format === 'bookings';
  const fields: (string | number | null)[] = [
    quote('EXTF'), // 1 Kennzeichen
    700, // 2 Versionsnummer
    bookings ? 21 : 16, // 3 Formatkategorie: Buchungsstapel bzw. Debitoren/Kreditoren
    quote(bookings ? 'Buchungsstapel' : 'Debitoren/Kreditoren'), // 4 Formatname
    bookings ? 12 : 5, // 5 Formatversion
    timestamp(h.createdAt), // 6 erzeugt am
    null, // 7 importiert (reserviert)
    quote('RE'), // 8 Herkunft: Rechnungswesen
    quote('GartenAI'), // 9 exportiert von
    quote(''), // 10 importiert von
    h.consultantNumber, // 11 Beraternummer
    h.clientNumber, // 12 Mandantennummer
    h.fiscalYearStart, // 13 Beginn Wirtschaftsjahr
    4, // 14 Sachkontenlänge
    // Stammdaten haben keinen Zeitraum, keinen Buchungstyp und keine Währung
    bookings ? h.from : null, // 15 Datum vom
    bookings ? h.to : null, // 16 Datum bis
    quote(clip(h.label, 30)), // 17 Bezeichnung
    quote(''), // 18 Diktatkürzel
    bookings ? 1 : null, // 19 Buchungstyp: Finanzbuchführung
    bookings ? 0 : null, // 20 Rechnungslegungszweck
    bookings ? 0 : null, // 21 Festschreibung: nein, die Kanzlei kann noch bearbeiten
    quote(bookings ? 'EUR' : ''), // 22 Währung
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

// Personenkonto (Debitor) für die Stammdaten
export interface ExtfDebtor {
  account: number;
  name: string;
  isBusiness: boolean;
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
  email?: string | null;
  phone?: string | null;
  vatId?: string | null;
}

function debtorLine(d: ExtfDebtor): string {
  // USt-IdNr. „DE123456789“: Länderkennzeichen und Nummer getrennt
  const vat = d.vatId?.replace(/\s+/g, '').toUpperCase() ?? '';
  const vatMatch = /^([A-Z]{2})([A-Z0-9+*]{2,12})$/.exec(vat);
  const values: Partial<Record<DebtorColumn, string | number>> = {
    Konto: d.account,
    // Adressattyp 2 = Unternehmen, 0 = keine Angabe (Name ungeteilt)
    ...(d.isBusiness
      ? { 'Name (Adressattyp Unternehmen)': clip(d.name, 50), Adressattyp: 2 }
      : { 'Name (Adressattyp keine Angabe)': clip(d.name, 50), Adressattyp: 0 }),
    Kurzbezeichnung: clip(d.name, 15),
    ...(vatMatch ? { 'EU-Land': vatMatch[1], 'EU-UStID': vatMatch[2] } : {}),
    ...(d.street || d.postalCode || d.city
      ? {
          Adressart: 'STR',
          Straße: clip(d.street ?? '', 36),
          Postleitzahl: clip(d.postalCode ?? '', 10),
          Ort: clip(d.city ?? '', 30),
        }
      : {}),
    ...(d.phone ? { Telefon: clip(d.phone, 60) } : {}),
    ...(d.email ? { 'E-Mail': clip(d.email, 60) } : {}),
  };
  return DEBTOR_COLUMNS.map((column) => {
    const value = values[column];
    if (DEBTOR_NUMERIC_COLUMNS.has(column)) return value === undefined ? '' : String(value);
    return quote(value === undefined ? '' : String(value));
  }).join(';');
}

// Debitoren-Stammdaten (EXTF „Debitoren/Kreditoren“): legt in DATEV die
// Personenkonten mit Name und Anschrift an, passend zu den Buchungsstapeln
export function buildDebitoren(header: ExtfHeader, debtors: ExtfDebtor[]): Buffer {
  const lines = [
    headerLine(header, 'debtors'),
    DEBTOR_COLUMNS.map(quote).join(';'),
    ...debtors.map(debtorLine),
  ];
  return iconv.encode(lines.join('\r\n') + '\r\n', 'win1252');
}
