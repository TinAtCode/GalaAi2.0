import { parseMt940 } from '../src/bank/mt940';
import { parseBankCsv } from '../src/bank/bank-csv';
import { parseStatement } from '../src/bank/bank.service';
import { decodeText, parseAmount, parseDay } from '../src/bank/statement-keys';

// MT940 wie aus dem Online-Banking (deutsche ?-Unterfelder in :86:)
const MT940 = [
  ':20:STARTUMSE',
  ':25:DE89370400440532013000',
  ':28C:00042/001',
  ':60F:C260921EUR1000,00',
  ':61:2609220922CR119,00NTRFNONREF//B1234',
  ':86:166?00GUTSCHR. UEBERWEISUNG?20EREF+R-2026-0001?21SVWZ+Rechnung R-2026-0001 vi',
  '?22elen Dank?30COBADEFFXXX?31DE02120300000000202051?32Familie Birke',
  ':61:260923D45,90NDDTKREF+ABC//B5678',
  ':86:105?00LASTSCHRIFT?20SVWZ+Kundennr 4711 Diesel?32Tankstelle Mei?33er GmbH',
  ':61:260923RC20,00NRTINONREF',
  ':86:109?00RUECKUEBERWEISUNG?20Retoure',
  ':62F:C260923EUR1053,10',
  '-',
].join('\r\n');

describe('Kontoauszug MT940', () => {
  it('liest Gutschriften, Abbuchungen, Rückbuchungen, Gegenpartei und SEPA-Zweck', () => {
    const { entries, balances, skipped } = parseMt940(MT940);
    expect(skipped).toEqual({ notBooked: 0, foreignCurrency: 0 });
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      direction: 'credit',
      reversal: false,
      accountIban: 'DE89370400440532013000',
      bookingDate: '2026-09-22',
      amount: '119.00',
      counterpartyName: 'Familie Birke',
      counterpartyIban: 'DE02120300000000202051',
      remittance: 'Rechnung R-2026-0001 vielen Dank',
    });
    expect(entries[1]).toMatchObject({
      direction: 'debit',
      amount: '45.90',
      counterpartyName: 'Tankstelle Meier GmbH',
      remittance: 'Kundennr 4711 Diesel',
    });
    // Rückbuchung einer Gutschrift: Geld geht wieder ab
    expect(entries[2]).toMatchObject({ direction: 'debit', reversal: true, amount: '20.00' });
    expect(balances).toEqual([
      { accountIban: 'DE89370400440532013000', date: '2026-09-23', amount: '1053.10' },
    ]);
  });

  it('gleiche Datei ergibt gleiche Schlüssel, zwei gleiche Umsätze bleiben zwei', () => {
    const twice = MT940.replace(
      ':62F:',
      ':61:260922CR119,00NTRFNONREF\r\n:86:166?20SVWZ+Rechnung R-2026-0001 vielen Dank?31DE02120300000000202051?32Familie Birke\r\n:62F:',
    );
    const a = parseMt940(MT940).entries.map((e) => e.dedupeKey);
    const b = parseMt940(twice).entries.map((e) => e.dedupeKey);
    expect(new Set(b).size).toBe(b.length);
    expect(b.slice(0, 3)).toEqual(a);
  });

  it('Fremdwährungskonto und falsche Datei', () => {
    const usd = MT940.replace(':60F:C260921EUR', ':60F:C260921USD').replace(
      ':62F:C260923EUR',
      ':62F:C260923USD',
    );
    expect(parseMt940(usd)).toMatchObject({ entries: [], balances: [], skipped: { foreignCurrency: 3 } });
    expect(() => parseMt940(':20:X\n:25:Y')).toThrow('kein MT940');
  });
});

describe('Kontoauszug als CSV', () => {
  it('Sparkasse (CSV-CAMT): Semikolon, deutsches Datum und Betrag, vorgemerkte Umsätze', () => {
    const csv = [
      '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"',
      '"DE89370400440532013000";"22.09.26";"22.09.26";"GUTSCHR. UEBERW.";"Rechnung R-2026-0001";"Familie Birke";"DE02120300000000202051";"COBADEFFXXX";"1.190,00";"EUR";"Umsatz gebucht"',
      '"DE89370400440532013000";"23.09.26";"23.09.26";"LASTSCHRIFT";"Diesel";"Tankstelle Meier";"DE44500105175407324931";"";"-45,90";"EUR";"Umsatz gebucht"',
      '"DE89370400440532013000";"24.09.26";"24.09.26";"GUTSCHR.";"offen";"X";"";"";"10,00";"EUR";"Umsatz vorgemerkt"',
      '"DE89370400440532013000";"24.09.26";"24.09.26";"GUTSCHR.";"usd";"Y";"";"";"10,00";"USD";"Umsatz gebucht"',
    ].join('\n');
    const { entries, skipped } = parseBankCsv(csv);
    expect(skipped).toEqual({ notBooked: 1, foreignCurrency: 1 });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      direction: 'credit',
      accountIban: 'DE89370400440532013000',
      bookingDate: '2026-09-22',
      amount: '1190.00',
      counterpartyName: 'Familie Birke',
      counterpartyIban: 'DE02120300000000202051',
      remittance: 'Rechnung R-2026-0001',
    });
    expect(entries[1]).toMatchObject({
      direction: 'debit',
      amount: '45.90',
      counterpartyName: 'Tankstelle Meier',
    });
  });

  it('DKB: Vorspann mit Konto, eigene Spaltennamen', () => {
    const csv = [
      '"Konto:";"DE12 1203 0000 1020 3040 50"',
      '"Kontostand vom 24.09.2026:";"2.345,67 €"',
      '',
      '"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)"',
      '"24.09.26";"24.09.26";"Gebucht";"Familie Birke";"Musterbetrieb";"R-2026-0002";"Eingang";"DE02120300000000202051";"250,50"',
    ].join('\n');
    const { entries } = parseBankCsv(csv);
    expect(entries).toEqual([
      expect.objectContaining({
        accountIban: 'DE12120300001020304050',
        bookingDate: '2026-09-24',
        amount: '250.50',
        direction: 'credit',
        counterpartyName: 'Familie Birke',
        remittance: 'R-2026-0002',
      }),
    ]);
  });

  it('getrennte Soll/Haben-Spalten und ISO-Datum; unbekanntes Format', () => {
    const csv = [
      'Datum,Soll,Haben,Name,Zweck',
      '2026-09-20,,"300,00",Kunde A,Anzahlung',
      '2026-09-21,"12,00",,Bank,Gebühr',
    ].join('\n');
    const { entries } = parseBankCsv(csv);
    expect(entries.map((e) => [e.direction, e.amount])).toEqual([
      ['credit', '300.00'],
      ['debit', '12.00'],
    ]);
    expect(() => parseBankCsv('a;b;c\n1;2;3')).toThrow('keine Spalten');
  });
});

describe('Hilfen für Kontoauszüge', () => {
  it('Beträge, Datumsangaben, Zeichensatz', () => {
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('-12,3')).toBe(-12.3);
    expect(parseAmount('1234.56')).toBe(1234.56);
    expect(parseAmount('1.500')).toBe(1500);
    expect(parseAmount('12,00-')).toBe(-12);
    expect(parseAmount('abc')).toBeNull();
    expect(parseDay('01.02.26')).toBe('2026-02-01');
    expect(parseDay('31.02.2026')).toBeNull();
    expect(parseDay('2026-09-24')).toBe('2026-09-24');
    // Windows-1252 (Umlaute aus älteren Bankexporten)
    expect(decodeText(Buffer.from([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]))).toBe('Müller');
  });

  it('Format wird am Inhalt erkannt', () => {
    const file = (text: string) => ({ buffer: Buffer.from(text), originalname: 'auszug.txt' });
    expect(parseStatement(file(MT940)).entries).toHaveLength(3);
    expect(parseStatement(file('Buchungstag;Betrag\n22.09.2026;5,00')).entries).toHaveLength(1);
    expect(() => parseStatement(file('<Document></Document>'))).toThrow();
  });
});
