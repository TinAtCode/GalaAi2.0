import { invoiceNumbersIn, parseCamt053 } from '../src/bank/camt053';
import { camtFixture } from './fixtures/camt/fixture';

describe('CAMT.053 (Kontoauszug)', () => {
  it('Version 001.08: nur gebuchte Gutschriften in EUR, mit Name, IBAN und Verwendungszweck', () => {
    const { credits, skipped } = parseCamt053(camtFixture('08'));
    expect(skipped).toEqual({ debits: 1, notBooked: 1, foreignCurrency: 0 });
    expect(credits).toHaveLength(3);
    expect(credits[0]).toEqual({
      dedupeKey: 'DE89370400440532013000|REF-0001',
      accountIban: 'DE89370400440532013000',
      bookingDate: '2026-09-22',
      amount: '100.00',
      debtorName: 'Familie Birke',
      debtorIban: 'DE02120300000000202051',
      remittance: 'Rechnung R-2026-0001 vielen Dank',
    });
    expect(credits[1]).toMatchObject({
      debtorName: 'Hausverwaltung Ahorn',
      debtorIban: null,
      amount: '50.00',
    });
    expect(credits[2]).toMatchObject({ remittance: 'Gartenpflege Juli', amount: '75.00' });
  });

  it('Version 001.02: Status als Text, Name direkt unter Dbtr', () => {
    const { credits } = parseCamt053(camtFixture('02'));
    expect(credits).toEqual([
      expect.objectContaining({
        dedupeKey: 'DE89370400440532013000|REF-V02-0001',
        bookingDate: '2026-09-21',
        debtorName: 'Familie Birke',
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
    const { credits, skipped } = parseCamt053(xml);
    expect(skipped.foreignCurrency).toBe(1);
    expect(credits[0]).toMatchObject({
      dedupeKey: 'DE89370400440532013000|BATCH-1/0',
      amount: '200.00',
      debtorName: 'A',
    });
  });

  it('akzeptiert weitere Namespaces vor dem camt-Namespace und einfache Anführungszeichen', () => {
    const xml = camtFixture('08').replace(
      '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"',
      `<Document xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns='urn:iso:std:iso:20022:tech:xsd:camt.053.001.08'`,
    );
    expect(parseCamt053(xml).credits).toHaveLength(3);
  });

  it('ohne Bankreferenz: gleiche Überweisungen bleiben getrennt, erneutes Einlesen ergibt dieselben Schlüssel', () => {
    // alle Bankreferenzen entfernen und die erste Gutschrift verdoppeln;
    // EndToEndId (vom Zahler gewählt) ist bei beiden gleich
    const withoutRefs = camtFixture('08').replace(/<AcctSvcrRef>[^<]*<\/AcctSvcrRef>/g, '');
    const first = /<Ntry>[\s\S]*?<\/Ntry>/.exec(withoutRefs)![0];
    expect(first).toContain('<EndToEndId>');
    const xml = withoutRefs.replace(first, first + first);
    const keys = parseCamt053(xml).credits.map((c) => c.dedupeKey);
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
    expect(parseCamt053(xml).credits.map((c) => c.dedupeKey)).toEqual(keys);
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
