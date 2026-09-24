import { BadRequestException } from '@nestjs/common';
import * as Papa from 'papaparse';
import * as iconv from 'iconv-lite';
import { readSheet } from 'read-excel-file/node';
import { assertZipWithinLimits } from '../common/zip-guard';

// Stammdaten aus „beliebigen Quellen“ als Tabelle: Kopfzeile + Zeilen aus
// Texten. Erkannt werden Excel (.xlsx), CSV/Text mit beliebigem Trennzeichen
// (Semikolon, Komma, Tab, senkrechter Strich) in UTF-8 oder Windows-1252,
// aus Excel kopierter Text (Tabs), JSON (Liste von Objekten) und vCard
// (Kontakte aus Outlook, Handy, Webmail).

export interface SourceTable {
  headers: string[];
  rows: string[][];
}

export const MAX_ROWS = 5000;

const cell = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
};

// UTF-8 mit Ersatzzeichen = eigentlich Windows-1252 (Excel „CSV“ unter Windows)
function decodeText(buffer: Buffer) {
  const text = buffer.toString('utf8');
  const decoded = text.includes(String.fromCharCode(0xfffd)) ? iconv.decode(buffer, 'win1252') : text;
  return decoded.replace(/^\uFEFF/, '');
}

function finish(headers: string[], rows: string[][]): SourceTable {
  const width = headers.length;
  const cleaned = rows
    .map((row) => Array.from({ length: width }, (_, i) => cell(row[i])))
    .filter((row) => row.some((value) => value !== ''));
  if (!headers.some(Boolean)) throw new BadRequestException('Keine Kopfzeile gefunden.');
  if (!cleaned.length) throw new BadRequestException('Die Quelle enthält keine Datenzeilen.');
  if (cleaned.length > MAX_ROWS) {
    throw new BadRequestException(`Höchstens ${MAX_ROWS} Zeilen auf einmal (gefunden: ${cleaned.length}).`);
  }
  // leere oder doppelte Spaltennamen eindeutig machen
  const seen = new Map<string, number>();
  const unique = headers.map((h, i) => {
    const base = cell(h) || `Spalte ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
  return { headers: unique, rows: cleaned };
}

export function parseDelimited(text: string): SourceTable {
  const parsed = Papa.parse<string[]>(text.trim(), {
    delimitersToGuess: ['\t', ';', ',', '|'],
    skipEmptyLines: 'greedy',
  });
  const [header, ...rows] = parsed.data;
  if (!header) throw new BadRequestException('Die Quelle ist leer.');
  return finish(header, rows);
}

export function parseJson(text: string): SourceTable {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BadRequestException('Die JSON-Datei konnte nicht gelesen werden.');
  }
  const list = Array.isArray(data)
    ? data
    : Object.values((data ?? {}) as Record<string, unknown>).find(Array.isArray);
  if (
    !Array.isArray(list) ||
    !list.every((item) => item && typeof item === 'object' && !Array.isArray(item))
  ) {
    throw new BadRequestException('Erwartet wird eine Liste von Objekten, z.B. [{"name": "…"}].');
  }
  const headers = [...new Set(list.flatMap((item) => Object.keys(item as object)))];
  const rows = list.map((item) =>
    headers.map((h) => {
      const value = (item as Record<string, unknown>)[h];
      return value !== null && typeof value === 'object' ? JSON.stringify(value) : cell(value);
    }),
  );
  return finish(headers, rows);
}

// vCard 2.1–4.0: je Kontakt eine Zeile mit Name, Firma, E-Mail, Telefon, Adresse
export function parseVcard(text: string): SourceTable {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1);
  const unescape = (v: string) =>
    v
      .replace(/\\n/gi, ' ')
      .replace(/\\([,;\\])/g, '$1')
      .trim();
  const rows = cards.map((card) => {
    const lines = card.split(/\r?\n/);
    const get = (prop: string) => {
      const line = lines.find((l) => new RegExp(`^(item\\d+\\.)?${prop}[;:]`, 'i').test(l));
      return line ? line.slice(line.indexOf(':') + 1) : '';
    };
    const org = unescape(get('ORG').split(';')[0] ?? '');
    const fn = unescape(get('FN'));
    const [, , street = '', city = '', , postalCode = ''] = get('ADR').split(';').map(unescape);
    return [org || fn, org ? fn : '', unescape(get('EMAIL')), unescape(get('TEL')), street, postalCode, city];
  });
  return finish(['Name', 'Ansprechpartner', 'E-Mail', 'Telefon', 'Straße', 'PLZ', 'Ort'], rows);
}

async function parseXlsx(buffer: Buffer): Promise<SourceTable> {
  assertZipWithinLimits(buffer);
  let sheet: unknown[][];
  try {
    sheet = await readSheet(buffer);
  } catch {
    throw new BadRequestException('Die Excel-Datei konnte nicht gelesen werden.');
  }
  // Kopfzeile = erste Zeile mit mindestens zwei gefüllten Zellen (Titelzeilen überspringen)
  const start = sheet.findIndex((row) => row.filter((c) => cell(c) !== '').length >= 2);
  if (start < 0) throw new BadRequestException('Die Excel-Datei enthält keine Tabelle.');
  return finish(
    sheet[start].map(cell),
    sheet.slice(start + 1).map((row) => row.map(cell)),
  );
}

export async function parseSource(fileName: string, buffer: Buffer): Promise<SourceTable> {
  const name = fileName.toLowerCase();
  if (buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])) || name.endsWith('.xls')) {
    throw new BadRequestException(
      'Das alte Excel-Format (.xls) wird nicht unterstützt. Bitte in Excel als .xlsx oder .csv speichern.',
    );
  }
  // .xlsx ist ein ZIP-Archiv
  if (buffer.subarray(0, 2).toString('latin1') === 'PK') return parseXlsx(buffer);
  return parseText(decodeText(buffer));
}

export function parseText(text: string): SourceTable {
  const trimmed = text.trim();
  if (!trimmed) throw new BadRequestException('Die Quelle ist leer.');
  if (/^BEGIN:VCARD/i.test(trimmed)) return parseVcard(trimmed);
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return parseJson(trimmed);
  return parseDelimited(trimmed);
}
