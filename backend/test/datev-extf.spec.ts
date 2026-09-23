import { Prisma } from '@prisma/client';
import * as iconv from 'iconv-lite';
import { EXTF_COLUMNS } from '../src/datev/extf-columns';
import { buildBuchungsstapel, ExtfBooking, ExtfHeader } from '../src/datev/extf-writer';
import { revenueAccountFor, revenueAccounts } from '../src/datev/revenue-accounts';

const header: ExtfHeader = {
  consultantNumber: 29098,
  clientNumber: 55003,
  fiscalYearStart: '20260101',
  from: '20260901',
  to: '20260930',
  chart: 'SKR03',
  label: 'Ausgangsrechnungen 09/2026',
  createdAt: new Date('2026-09-23T12:34:56.789Z'),
};
const booking: ExtfBooking = {
  amount: new Prisma.Decimal('1190.5'),
  side: 'S',
  account: 10000,
  contraAccount: 8400,
  documentDate: '2309',
  documentNumber: 'R-2026-0001',
  text: 'Rechnung',
};
const decode = (buf: Buffer) => iconv.decode(buf, 'win1252').split('\r\n');
const cell = (line: string, column: (typeof EXTF_COLUMNS)[number]) =>
  line.split(';')[EXTF_COLUMNS.indexOf(column)];

describe('DATEV EXTF-Buchungsstapel', () => {
  it('Kopfzeile mit 31 Feldern, Zeitstempel in UTC, Zeilenende CRLF', () => {
    const buf = buildBuchungsstapel(header, [booking]);
    const [first, columns, row, end] = decode(buf);
    expect(first).toBe(
      '"EXTF";700;21;"Buchungsstapel";12;20260923123456789;;"RE";"GartenAI";"";29098;55003;20260101;4;20260901;20260930;"Ausgangsrechnungen 09/2026";"";1;0;0;"EUR";;"";;;"03";;;"";""',
    );
    expect(columns.split(';')).toHaveLength(124);
    expect(row.split(';')).toHaveLength(124);
    expect(end).toBe('');
    expect(buf.subarray(0, 3).toString()).not.toBe('﻿'); // keine BOM
  });

  it('Beträge mit Komma, Texte gekürzt und maskiert, Zahlenfelder leer statt ""', () => {
    const [, , row] = decode(
      buildBuchungsstapel({ ...header, chart: 'SKR04' }, [
        {
          ...booking,
          amount: new Prisma.Decimal('1234567.891'),
          text: 'Rechnung "Grün" & Co;\nmit einem sehr langen Namen, der deutlich über sechzig Zeichen hinausgeht',
          documentNumber: 'R-2026 0001 (Kopie)',
          serviceDate: '20092026',
        },
      ]),
    );
    expect(cell(row, 'Umsatz')).toBe('1234567,89');
    expect(cell(row, 'Soll-/Haben-Kennzeichen')).toBe('"S"');
    const text = cell(row, 'Buchungstext');
    expect(text.startsWith('"Rechnung ""Grün"" & Co mit einem')).toBe(true);
    expect(text.replace(/""/g, '"').slice(1, -1)).toHaveLength(60);
    expect(cell(row, 'Belegfeld 1')).toBe('"R-20260001Kopie"');
    expect(cell(row, 'Kurs')).toBe('');
    expect(cell(row, 'BU-Schlüssel')).toBe('""');
    expect(cell(row, 'Leistungsdatum')).toBe('20092026');
    expect(cell(row, 'Fälligkeit')).toBe('');
  });

  it('Erlöskonten nach Kontenrahmen, Steuersatz und Behandlung; Abweichungen je Firma', () => {
    const skr03 = revenueAccounts('SKR03', null);
    const invoice = (vatTreatment: 'standard' | 'small_business' | 'reverse_charge', rate: string) => ({
      number: 'R-1',
      vatTreatment,
      vatRate: new Prisma.Decimal(rate),
    });
    expect(revenueAccountFor(skr03, invoice('standard', '19.00'))).toBe(8400);
    expect(revenueAccountFor(skr03, invoice('standard', '7'))).toBe(8300);
    expect(revenueAccountFor(skr03, invoice('small_business', '0'))).toBe(8195);
    expect(revenueAccountFor(skr03, invoice('reverse_charge', '0'))).toBe(8337);
    expect(() => revenueAccountFor(skr03, invoice('standard', '16'))).toThrow(/16 %/);
    const skr04 = revenueAccounts('SKR04', { standard7: 4310, bogus: 1 });
    expect(skr04).toEqual({ standard19: 4400, standard7: 4310, smallBusiness: 4185, reverseCharge: 4337 });
  });
});
