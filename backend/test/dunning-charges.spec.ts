import { Prisma } from '@prisma/client';
import { defaultInterestFrom, dunningCharges, DunningSettings } from '../src/invoices/dunning-charges';

const D = (n: string | number) => new Prisma.Decimal(n);
const off: DunningSettings = {
  fees: [D(0), D(0), D(0)],
  interest: false,
  baseInterestRate: null,
  lumpSum: false,
};
const on: DunningSettings = {
  fees: [D(0), D('5.00'), D('7.50')],
  interest: true,
  baseInterestRate: D('1.27'),
  lumpSum: true,
};
const first = { level: 1, issuedOn: '2026-09-01', lumpSum: D(0) };

describe('Mahngebühren und Verzugszinsen', () => {
  it('Standard aus: nichts berechnet', () => {
    const result = dunningCharges({
      level: 2,
      today: '2026-09-15',
      dueDay: '2026-08-01',
      open: D(1000),
      isBusiness: true,
      previous: [first],
      settings: off,
    });
    expect(result).toEqual({
      fee: D(0),
      interest: D(0),
      interestRate: null,
      interestFrom: null,
      lumpSum: D(0),
    });
  });

  it('Verzugsbeginn: Tag nach der ersten Mahnung; Geschäftskunden spätestens 30 Tage nach Fälligkeit', () => {
    expect(defaultInterestFrom({ dueDay: '2026-08-01', isBusiness: false, previous: [] })).toBeNull();
    expect(defaultInterestFrom({ dueDay: '2026-08-01', isBusiness: false, previous: [first] })).toBe(
      '2026-09-02',
    );
    expect(defaultInterestFrom({ dueDay: '2026-08-01', isBusiness: true, previous: [] })).toBe('2026-09-01');
    expect(defaultInterestFrom({ dueDay: '2026-08-20', isBusiness: true, previous: [first] })).toBe(
      '2026-09-02',
    );
  });

  it('Verbraucher: Basiszins + 5, taggenau; keine Pauschale', () => {
    // 1000 € × 6,27 % × 14 Tage / 365 = 2,405… -> 2,40
    const result = dunningCharges({
      level: 2,
      today: '2026-09-15',
      dueDay: '2026-08-01',
      open: D(1000),
      isBusiness: false,
      previous: [first],
      settings: on,
    });
    expect(result.fee.toString()).toBe('5');
    expect(result.interestRate!.toString()).toBe('6.27');
    expect(result.interestFrom).toBe('2026-09-02');
    expect(result.interest.toString()).toBe('2.4');
    expect(result.lumpSum.toString()).toBe('0');
  });

  it('Geschäftskunde: Basiszins + 9, Pauschale 40 € einmalig', () => {
    const input = {
      level: 1,
      today: '2026-09-10',
      dueDay: '2026-08-01',
      open: D(2000),
      isBusiness: true,
      previous: [],
      settings: on,
    };
    // Verzug ab 01.09. (nach 30 Tagen ab Fälligkeit 01.08.): 10 Tage × 10,27 %
    const result = dunningCharges(input);
    expect(result.interestFrom).toBe('2026-09-01');
    expect(result.interest.toString()).toBe('5.63');
    expect(result.lumpSum.toString()).toBe('40');
    const next = dunningCharges({
      ...input,
      level: 2,
      today: '2026-09-20',
      previous: [{ level: 1, issuedOn: '2026-09-10', lumpSum: D(40) }],
    });
    expect(next.lumpSum.toString()).toBe('0');
    expect(next.fee.toString()).toBe('5');
  });

  it('Zahlungserinnerung an Verbraucher: noch kein Verzug; ohne Basiszinssatz keine Zinsen', () => {
    const reminder = dunningCharges({
      level: 1,
      today: '2026-09-01',
      dueDay: '2026-08-01',
      open: D(500),
      isBusiness: false,
      previous: [],
      settings: on,
    });
    expect(reminder.interest.toString()).toBe('0');
    expect(reminder.interestFrom).toBeNull();
    const noRate = dunningCharges({
      level: 2,
      today: '2026-09-15',
      dueDay: '2026-08-01',
      open: D(500),
      isBusiness: false,
      previous: [first],
      settings: { ...on, baseInterestRate: null },
    });
    expect(noRate.interest.toString()).toBe('0');
  });
});
