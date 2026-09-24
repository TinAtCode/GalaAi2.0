import { Prisma } from '@prisma/client';
import { normalizeName, suggestCategory } from '../src/finance/categorize';
import { addMonths, detectRecurring, dueDatesBetween } from '../src/finance/recurring';

const learnedNone = { byIban: new Map<string, string>(), byName: new Map<string, string>() };
const entry = (name: string | null, remittance: string | null = null, iban: string | null = null) => ({
  counterpartyName: name,
  counterpartyIban: iban,
  remittance,
});

describe('Kategorien vorschlagen', () => {
  const rules = [
    { categoryId: 'fahrzeuge', pattern: 'aral', field: 'any' as const },
    { categoryId: 'material', pattern: 'baustoff', field: 'counterparty' as const },
    { categoryId: 'steuern', pattern: 'DE11 5205 1373 5120 7017 23', field: 'iban' as const },
  ];

  it('Regeln: Stichwort in Empfänger oder Verwendungszweck, IBAN genau', () => {
    expect(suggestCategory(entry('ARAL Station 123'), rules, learnedNone)).toEqual({
      categoryId: 'fahrzeuge',
      source: 'rule',
    });
    expect(suggestCategory(entry('Kartenzahlung', 'ARAL Tankstelle'), rules, learnedNone)?.categoryId).toBe(
      'fahrzeuge',
    );
    // Feld "Empfänger": nicht im Verwendungszweck
    expect(suggestCategory(entry('Bank', 'Baustoffe Müller'), rules, learnedNone)).toBeNull();
    expect(
      suggestCategory(entry('Finanzamt', null, 'DE11520513735120701723'), rules, learnedNone)?.categoryId,
    ).toBe('steuern');
    expect(suggestCategory(entry('Unbekannt'), rules, learnedNone)).toBeNull();
  });

  it('Satzzeichen und Wortgrenzen: Regel aus dem Empfängernamen trifft wieder', () => {
    const fromName = [
      {
        categoryId: 'material',
        pattern: normalizeName('Müller GmbH & Co. KG'),
        field: 'counterparty' as const,
      },
      { categoryId: 'material', pattern: 'obi ', field: 'any' as const },
      { categoryId: 'fahrzeuge', pattern: 'kfz-steuer', field: 'any' as const },
    ];
    expect(suggestCategory(entry('Müller GmbH & Co. KG'), fromName, learnedNone)?.categoryId).toBe(
      'material',
    );
    expect(suggestCategory(entry('OBI Markt 12'), fromName, learnedNone)?.categoryId).toBe('material');
    // "obi " nur am Wortende: nicht in "Obitec"
    expect(suggestCategory(entry('Obitec AG'), fromName, learnedNone)).toBeNull();
    expect(
      suggestCategory(entry('Hauptzollamt', 'KFZ-Steuer B-XY 12'), fromName, learnedNone)?.categoryId,
    ).toBe('fahrzeuge');
  });

  it('Gelerntes vor Regeln: gleiche IBAN, sonst gleicher Name', () => {
    const learned = {
      byIban: new Map([['DE02120300000000202051', 'maschinen']]),
      byName: new Map([['aral station 123', 'buero']]),
    };
    expect(suggestCategory(entry('ARAL', null, 'de02 1203 0000 0000 2020 51'), rules, learned)).toEqual({
      categoryId: 'maschinen',
      source: 'learned',
    });
    expect(suggestCategory(entry('Aral Station 123!'), rules, learned)).toEqual({
      categoryId: 'buero',
      source: 'learned',
    });
  });
});

describe('Wiederkehrende Zahlungen erkennen', () => {
  const d = (
    bookingDate: string,
    amount: number,
    name = 'Leasing GmbH',
    iban: string | null = 'DE44500105175407324931',
  ) => ({
    bookingDate,
    amount: new Prisma.Decimal(amount),
    counterpartyName: name,
    counterpartyIban: iban,
    categoryId: null,
  });

  it('monatlich mit leicht schwankendem Datum und Betrag', () => {
    const [s] = detectRecurring([
      d('2026-06-03', 640),
      d('2026-07-02', 640),
      d('2026-08-04', 655),
      d('2026-09-03', 640),
    ]);
    expect(s).toMatchObject({
      interval: 'monthly',
      occurrences: 4,
      lastDate: '2026-09-03',
      nextDue: '2026-10-03',
    });
    expect(Number(s.amount)).toBeCloseTo(643.75);
  });

  it('vierteljährlich und jährlich (jährlich genügen zwei Buchungen)', () => {
    const q = detectRecurring(
      [d('2026-01-15', 450, 'StB'), d('2026-04-15', 450, 'StB'), d('2026-07-15', 450, 'StB')].map((x) => ({
        ...x,
        counterpartyIban: null,
      })),
    );
    expect(q[0]).toMatchObject({ interval: 'quarterly', nextDue: '2026-10-15' });
    const y = detectRecurring(
      [d('2025-03-01', 2400, 'Versicherung'), d('2026-03-02', 2400, 'Versicherung')].map((x) => ({
        ...x,
        counterpartyIban: null,
      })),
    );
    expect(y[0]).toMatchObject({ interval: 'yearly', nextDue: '2027-03-02' });
  });

  it('kein Muster: unregelmäßig, zu wenige Buchungen oder stark schwankende Beträge', () => {
    expect(detectRecurring([d('2026-06-01', 50), d('2026-06-20', 50), d('2026-08-30', 50)])).toEqual([]);
    expect(detectRecurring([d('2026-07-01', 640), d('2026-08-01', 640)])).toEqual([]);
    expect(detectRecurring([d('2026-06-01', 100), d('2026-07-01', 300), d('2026-08-01', 100)])).toEqual([]);
  });
});

describe('Fälligkeiten', () => {
  it('Monatsende bleibt Monatsende', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
    expect(
      dueDatesBetween(
        { nextDue: '2026-01-31', interval: 'monthly', endDate: null },
        '2026-02-01',
        '2026-04-30',
      ),
    ).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('nichts vor der nächsten Fälligkeit (Zahlung beginnt später)', () => {
    const later = { nextDue: '2027-01-01', interval: 'monthly' as const, endDate: null };
    expect(dueDatesBetween(later, '2026-10-01', '2026-12-31')).toEqual([]);
    expect(dueDatesBetween(later, '2026-12-01', '2027-02-28')).toEqual(['2027-01-01', '2027-02-01']);
  });

  it('Rhythmus, Zeitraum und Enddatum', () => {
    expect(
      dueDatesBetween(
        { nextDue: '2026-01-15', interval: 'quarterly', endDate: null },
        '2026-01-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);
    expect(
      dueDatesBetween(
        { nextDue: '2026-10-03', interval: 'monthly', endDate: '2026-11-30' },
        '2026-10-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-10-03', '2026-11-03']);
    expect(
      dueDatesBetween(
        { nextDue: '2025-03-01', interval: 'yearly', endDate: null },
        '2026-01-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-03-01']);
  });
});
