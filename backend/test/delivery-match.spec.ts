import { findSupplier, rankNotes, supplierKey } from '../src/finance/payables/delivery-match';

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
});
