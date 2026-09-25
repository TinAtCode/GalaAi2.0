import {
  findSupplier,
  noteNumberPattern,
  rankNotes,
  supplierKey,
} from '../src/finance/payables/delivery-match';

describe('Lieferschein ↔ Eingangsrechnung', () => {
  const suppliers = [
    { id: 's1', name: 'Stein & Kies GmbH', matchTerms: [] },
    { id: 's2', name: 'Baustoff Nord', matchTerms: ['BSN Handel'] },
    { id: 's3', name: 'Pflanzen Meyer KG', matchTerms: [] },
    { id: 's4', name: 'Pflanzen Meyer e.K.', matchTerms: [] },
  ];

  it('Firmenname ohne Rechtsform, "&" = "und"', () => {
    expect(supplierKey('Stein & Kies GmbH & Co. KG')).toBe(supplierKey('Stein und Kies'));
    expect(findSupplier('STEIN UND KIES', suppliers)).toBe('s1');
  });

  it('Erkennungswort des Lieferanten; mehrdeutig oder unbekannt → keiner', () => {
    expect(findSupplier('BSN Handel GmbH', suppliers)).toBe('s2');
    expect(findSupplier('Pflanzen Meyer', suppliers)).toBeNull();
    expect(findSupplier('Holz Süd', suppliers)).toBeNull();
    expect(findSupplier('', suppliers)).toBeNull();
  });

  it('Nummer im Beleg zuerst, dann neueste; außerhalb des Zeitraums nur mit Nummer', () => {
    const ranked = rankNotes({ invoiceDate: '2026-05-31', text: 'Lieferschein LS 2026/0042 vom 12.05.' }, [
      { id: 'a', noteNumber: 'LS-2026-0040', noteDate: '2026-05-20' },
      { id: 'b', noteNumber: 'LS-2026/0042', noteDate: '2026-05-12' },
      { id: 'c', noteNumber: 'X1', noteDate: '2026-06-02' }, // nach der Rechnung
      { id: 'd', noteNumber: null, noteDate: '2025-11-01' }, // zu alt
      { id: 'e', noteNumber: null, noteDate: null }, // ohne Datum: möglich
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['b', 'a', 'e']);
    expect(ranked[0].reasons).toEqual(['number', 'date']);
    expect(ranked[1].reasons).toEqual(['date']);
  });

  it('kurze Nummern zählen nicht als Treffer', () => {
    const ranked = rankNotes({ invoiceDate: null, text: 'Rechnung 12' }, [
      { id: 'a', noteNumber: '12', noteDate: null },
    ]);
    expect(ranked[0].reasons).toEqual([]);
  });

  it('Nummer nur an Wortgrenzen: nicht in Beträgen, Daten oder längeren Zahlen', () => {
    const hit = (number: string, text: string) => noteNumberPattern(number)!.test(text.toLowerCase());
    expect(hit('4711', 'Betrag 47,11 €')).toBe(false);
    expect(hit('0320', 'Datum 12.03.2026')).toBe(false);
    expect(hit('4711', 'Kundennr. 147110')).toBe(false);
    expect(hit('4711', 'Lieferschein 4711 vom 3.5.')).toBe(true);
    expect(hit('LS-2026/0042', 'laut LS 2026 0042')).toBe(true);
    expect(hit('LS-0042', 'LS0042')).toBe(true);
    expect(noteNumberPattern('12')).toBeNull();
    // falscher Treffer wäre sonst vorausgewählt und ganz oben
    const ranked = rankNotes({ invoiceDate: '2026-05-31', text: 'Summe 47,11 € vom 12.03.2026' }, [
      { id: 'x', noteNumber: '4711', noteDate: null },
      { id: 'y', noteNumber: '0320', noteDate: null },
    ]);
    expect(ranked.every((r) => !r.reasons.includes('number'))).toBe(true);
  });
});
