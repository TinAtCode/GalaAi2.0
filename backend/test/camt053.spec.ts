import { invoiceNumbersIn, parseCamt053 } from '../src/bank/camt053';
import { camtFixture } from './fixtures/camt/fixture';

// nur die Zahlungseingänge
const creditsOf = (xml: string) => parseCamt053(xml).entries.filter((e) => e.direction === 'credit');

describe('CAMT.053 (Kontoauszug)', () => {
  it('Version 001.08: gebuchte Umsätze in EUR, mit Gegenpartei, IBAN und Verwendungszweck', () => {
    const { entries, skipped } = parseCamt053(camtFixture('08'));
    expect(skipped).toEqual({ notBooked: 1, foreignCurrency: 0 });
    const credits = entries.filter((e) => e.direction === 'credit');
    expect(credits).toHaveLength(3);
    expect(credits[0]).toEqual({
      dedupeKey: 'DE89370400440532013000|REF-0001',
      direction: 'credit',
      reversal: false,
      accountIban: 'DE89370400440532013000',
      bookingDate: '2026-09-22',
      amount: '100.00',
      counterpartyName: 'Familie Birke',
      counterpartyIban: 'DE02120300000000202051',
      remittance: 'Rechnung R-2026-0001 vielen Dank',
    });
    expect(credits[1]).toMatchObject({
      counterpartyName: 'Hausverwaltung Ahorn',
      counterpartyIban: null,
      amount: '50.00',
    });
    expect(credits[2]).toMatchObject({ remittance: 'Gartenpflege Juli', amount: '75.00' });
  });

  it('Abbuchungen mit dem Empfänger als Gegenpartei; Schlusssaldo je Konto', () => {
    const { entries, balances } = parseCamt053(camtFixture('08'));
    expect(entries.filter((e) => e.direction === 'debit')).toEqual([
      expect.objectContaining({
        dedupeKey: 'DE89370400440532013000|REF-0003',
        amount: '49.90',
        counterpartyName: 'Mobilfunk AG',
        remittance: 'Rechnung September',
      }),
    ]);
    expect(balances).toEqual([
      { accountIban: 'DE89370400440532013000', date: '2026-09-22', amount: '15230.45' },
    ]);

    // Soll-Saldo wird negativ; Anfangssaldo (OPBD) zählt nicht
    const overdrawn = camtFixture('08').replace(
      /<Bal>[\s\S]*?<\/Bal>/,
      `<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-09-21</Dt></Dt></Bal>
       <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">812.30</Amt><CdtDbtInd>DBIT</CdtDbtInd><Dt><Dt>2026-09-22</Dt></Dt></Bal>`,
    );
    expect(parseCamt053(overdrawn).balances).toEqual([
      { accountIban: 'DE89370400440532013000', date: '2026-09-22', amount: '-812.30' },
    ]);
  });

  it('Rückbuchung: gekennzeichnet, Gegenpartei aus der ursprünglichen Zahlung', () => {
    // zurückgekommene eigene Überweisung: Gutschrift mit RvslInd, Empfänger steht unter Cdtr
    const xml = camtFixture('08').replace(
      /<Ntry>\s*<Amt Ccy="EUR">49\.90<\/Amt>[\s\S]*?<\/Ntry>/,
      `<Ntry><Amt Ccy="EUR">49.90</Amt><CdtDbtInd>CRDT</CdtDbtInd><RvslInd>true</RvslInd>
        <Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-09-22</Dt></BookgDt><AcctSvcrRef>REF-0003</AcctSvcrRef>
        <NtryDtls><TxDtls><RltdPties><Cdtr><Pty><Nm>Mobilfunk AG</Nm></Pty></Cdtr></RltdPties></TxDtls></NtryDtls></Ntry>`,
    );
    const entry = parseCamt053(xml).entries.find((e) => e.dedupeKey.endsWith('REF-0003'))!;
    expect(entry).toMatchObject({ direction: 'credit', reversal: true, counterpartyName: 'Mobilfunk AG' });
    expect(creditsOf(camtFixture('08')).every((e) => !e.reversal)).toBe(true);
  });

  it('Version 001.02: Status als Text, Name direkt unter Dbtr', () => {
    expect(creditsOf(camtFixture('02'))).toEqual([
      expect.objectContaining({
        dedupeKey: 'DE89370400440532013000|REF-V02-0001',
        bookingDate: '2026-09-21',
        counterpartyName: 'Familie Birke',
        remittance: 'RE R-2026-0001',
      }),
    ]);
  });

  it('Sammelbuchung mit Einzelbeträgen wird aufgeteilt, Fremdwährung übersprungen', () => {
    const tx = (amount: string, ccy: string, name: string, text: string) => `
          <TxDtls>
            <Amt Ccy="${ccy}">${amount}</Amt>
            <RltdPties><Dbtr><Pty><Nm>${name}</Nm></Pty></Dbtr></RltdPties>
            <RmtInf><Ustrd>${text}</Ustrd></RmtInf>
          </TxDtls>`;
    const xml = camtFixture('08').replace(
      /<Ntry>\s*<Amt Ccy="EUR">100\.00<\/Amt>[\s\S]*?<\/Ntry>/,
      `<Ntry><Amt Ccy="EUR">300.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>2026-09-22</Dt></BookgDt><AcctSvcrRef>BATCH-1</AcctSvcrRef>
        <NtryDtls>${tx('200.00', 'EUR', 'A', 'R-2026-0003')}${tx('100.00', 'CHF', 'B', 'R-2026-0004')}</NtryDtls></Ntry>`,
    );
    expect(parseCamt053(xml).skipped.foreignCurrency).toBe(1);
    expect(creditsOf(xml)[0]).toMatchObject({
      dedupeKey: 'DE89370400440532013000|BATCH-1/0',
      amount: '200.00',
      counterpartyName: 'A',
    });
  });

  it('akzeptiert weitere Namespaces vor dem camt-Namespace und einfache Anführungszeichen', () => {
    const xml = camtFixture('08').replace(
      '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"',
      `<Document xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns='urn:iso:std:iso:20022:tech:xsd:camt.053.001.08'`,
    );
    expect(creditsOf(xml)).toHaveLength(3);
  });

  it('ohne Bankreferenz: gleiche Überweisungen bleiben getrennt, erneutes Einlesen ergibt dieselben Schlüssel', () => {
    // alle Bankreferenzen entfernen und die erste Gutschrift verdoppeln;
    // EndToEndId (vom Zahler gewählt) ist bei beiden gleich
    const withoutRefs = camtFixture('08').replace(/<AcctSvcrRef>[^<]*<\/AcctSvcrRef>/g, '');
    const first = /<Ntry>[\s\S]*?<\/Ntry>/.exec(withoutRefs)![0];
    expect(first).toContain('<EndToEndId>');
    const xml = withoutRefs.replace(first, first + first);
    const keys = creditsOf(xml).map((c) => c.dedupeKey);
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
    expect(creditsOf(xml).map((c) => c.dedupeKey)).toEqual(keys);
  });

  it('lehnt DOCTYPE (XXE, Entity-Expansion), kaputtes XML und andere Formate ab', () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><Document>&x;</Document>`;
    expect(() => parseCamt053(xxe)).toThrow(/DOCTYPE/);
    expect(() => parseCamt053('<Document><kaputt')).toThrow();
    expect(() => parseCamt053('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"/>')).toThrow(
      /CAMT\.053/,
    );
  });

  it('erkennt Rechnungsnummern im Verwendungszweck in üblichen Schreibweisen', () => {
    expect(invoiceNumbersIn('Rechnung R-2026-0001 vielen Dank')).toEqual(['R-2026-0001']);
    expect(invoiceNumbersIn('R20260002 Abschlag')).toEqual(['R-2026-0002']);
    expect(invoiceNumbersIn('RE 2026 0003 und R-2026-0004')).toEqual(['R-2026-0003', 'R-2026-0004']);
    expect(invoiceNumbersIn('R-2026-10000 und R202612345')).toEqual(['R-2026-10000', 'R-2026-12345']);
    expect(invoiceNumbersIn('Kundennr 12345, Gartenpflege')).toEqual([]);
    expect(invoiceNumbersIn(null)).toEqual([]);
  });
});
