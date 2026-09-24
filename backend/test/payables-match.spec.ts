import {
  bestMatches,
  discountedAmount,
  earliestPayment,
  MatchDebit,
  MatchPayable,
  scoreMatch,
} from '../src/finance/payables/match';
import { plannedPayment } from '../src/finance/payables/schedule';

const bill = (patch: Partial<MatchPayable> = {}): MatchPayable => ({
  id: 'p1',
  supplierName: 'Baumschule Lorenz GmbH',
  supplierIban: 'DE02120300000000202051',
  invoiceNumber: 'BL-55',
  invoiceDate: '2026-09-01',
  earliest: '2026-08-29',
  amount: '850.00',
  discountPercent: '3.00',
  discountUntil: '2026-09-11',
  ...patch,
});
const debit = (patch: Partial<MatchDebit> = {}): MatchDebit => ({
  id: 'd1',
  bookingDate: '2026-09-10',
  amount: '850.00',
  counterpartyName: 'Baumschule Lorenz',
  counterpartyIban: null,
  remittance: 'Rechnung BL 55',
  ...patch,
});

describe('Eingangsrechnung und Abbuchung zuordnen', () => {
  it('Betrag genau oder mit Skonto innerhalb der Frist', () => {
    expect(discountedAmount('850.00', '3.00')).toBe('824.50');
    expect(scoreMatch(bill(), debit())?.reasons).toEqual(['amount', 'number', 'name']);
    expect(scoreMatch(bill(), debit({ amount: '824.50' }))?.reasons).toContain('discount');
    // Skonto nach Frist (plus drei Tage Buchungsverzug) zählt nicht
    expect(scoreMatch(bill(), debit({ amount: '824.50', bookingDate: '2026-09-14' }))?.reasons).toContain(
      'discount',
    );
    expect(scoreMatch(bill(), debit({ amount: '824.50', bookingDate: '2026-09-15' }))).toBeNull();
    expect(scoreMatch(bill(), debit({ amount: '851.00' }))).toBeNull();
  });

  it('Betrag allein reicht nicht; nicht vor dem Rechnungsdatum', () => {
    expect(scoreMatch(bill(), debit({ counterpartyName: 'Kasse', remittance: 'x' }))).toBeNull();
    expect(
      scoreMatch(
        bill(),
        debit({
          counterpartyName: 'Kasse',
          remittance: 'x',
          counterpartyIban: 'DE02 1203 0000 0000 2020 51',
        }),
      )?.reasons,
    ).toEqual(['amount', 'iban']);
    expect(scoreMatch(bill(), debit({ bookingDate: '2026-08-20' }))).toBeNull();
    expect(scoreMatch(bill(), debit({ bookingDate: '2026-08-29' }))).not.toBeNull();
  });

  it('jede Abbuchung höchstens einmal; automatisch nur mit Nummer und eindeutig', () => {
    const matches = bestMatches(
      [bill(), bill({ id: 'p2', invoiceNumber: 'BL-56' })],
      [debit(), debit({ id: 'd2', remittance: 'Rechnung BL-56' })],
    );
    expect(matches.map((m) => [m.payableId, m.debit.id, m.auto])).toEqual([
      ['p1', 'd1', true],
      ['p2', 'd2', true],
    ]);
    // zwei gleich gute Abbuchungen: Vorschlag, aber nicht automatisch
    const tie = bestMatches([bill()], [debit(), debit({ id: 'd2' })]);
    expect(tie).toHaveLength(1);
    expect(tie[0].auto).toBe(false);
    // ohne Nummer im Verwendungszweck: nur Vorschlag
    expect(bestMatches([bill()], [debit({ remittance: 'Kartenzahlung' })])[0].auto).toBe(false);
  });
});

describe('Frühestes Zahlungsdatum', () => {
  it('Rechnungsdatum, sonst Fälligkeit, sonst Erfassen', () => {
    expect(earliestPayment({ invoiceDate: '2026-09-01', dueDate: null, createdAt: '2026-09-20' })).toBe(
      '2026-08-29',
    );
    // Miete für Oktober ohne Rechnungsdatum: die Abbuchung vom 06.09. gehört zum Vormonat
    expect(earliestPayment({ invoiceDate: null, dueDate: '2026-10-06', createdAt: '2026-09-20' })).toBe(
      '2026-09-08',
    );
    expect(earliestPayment({ invoiceDate: null, dueDate: null, createdAt: '2026-09-20' })).toBe('2026-08-23');
  });

  it('gleich gute Abbuchungen: die jüngere', () => {
    const [m] = bestMatches(
      [bill({ earliest: '2026-01-01', invoiceNumber: null })],
      [debit({ id: 'alt', bookingDate: '2026-08-10' }), debit({ id: 'neu', bookingDate: '2026-09-10' })],
    );
    expect(m.debit.id).toBe('neu');
  });
});

describe('Geplanter Zahltag', () => {
  const base = {
    amount: '850.00',
    invoiceDate: '2026-09-01',
    dueDate: '2026-10-01',
    discountPercent: '3.00',
    discountUntil: '2026-09-11',
  };
  it('mit Skonto, solange die Frist läuft; sonst zur Fälligkeit; Überfälliges ab heute', () => {
    expect(plannedPayment(base, '2026-09-05')).toEqual({
      date: '2026-09-11',
      amount: '824.50',
      withDiscount: true,
      overdue: false,
    });
    expect(plannedPayment(base, '2026-09-12')).toEqual({
      date: '2026-10-01',
      amount: '850.00',
      withDiscount: false,
      overdue: false,
    });
    expect(plannedPayment(base, '2026-10-05')).toEqual({
      date: '2026-10-05',
      amount: '850.00',
      withDiscount: false,
      overdue: true,
    });
    // ohne Fälligkeit: 14 Tage nach Rechnungsdatum
    expect(plannedPayment({ ...base, dueDate: null, discountPercent: null }, '2026-09-02').date).toBe(
      '2026-09-15',
    );
  });
});
