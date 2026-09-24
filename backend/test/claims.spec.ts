import { Prisma } from '@prisma/client';
import { allocatePayment, invoiceClaims, ClaimsInput } from '../src/invoices/claims';

const D = (v: number) => new Prisma.Decimal(v);
const notice = (level: number, fee: number, lumpSum: number, interest: number) => ({
  level,
  fee: D(fee),
  lumpSum: D(lumpSum),
  interest: D(interest),
});
const payment = (amount: number, costs = 0, interest = 0) => ({
  amount: D(amount),
  costsAmount: D(costs),
  interestAmount: D(interest),
});
const input = (over: Partial<ClaimsInput> = {}): ClaimsInput => ({
  totalGross: D(1000),
  payments: [],
  dunningNotices: [],
  chargeWaivers: [],
  ...over,
});
const n = (d: Prisma.Decimal) => d.toNumber();

describe('Forderung einer Rechnung (Mahnkosten, Zinsen, § 367 BGB)', () => {
  it('ohne Mahnung: nur der Rechnungsbetrag', () => {
    const c = invoiceClaims(input({ payments: [payment(400)] }));
    expect(n(c.principalOpen)).toBe(600);
    expect(n(c.chargesOpen)).toBe(0);
    expect(n(c.totalOpen)).toBe(600);
  });

  it('Gebühren und Pauschale je Stufe addiert, Zinsen aus der jüngsten Mahnung', () => {
    const c = invoiceClaims(input({ dunningNotices: [notice(2, 5, 0, 12.5), notice(1, 2.5, 40, 4.1)] }));
    expect(n(c.costs)).toBe(47.5);
    expect(n(c.interest)).toBe(12.5);
    expect(n(c.totalOpen)).toBe(1060);
  });

  it('Zahlung: erst Kosten, dann Zinsen, dann Rechnungsbetrag', () => {
    const c = invoiceClaims(input({ dunningNotices: [notice(1, 10, 0, 3)] }));
    const split = allocatePayment(c, D(20), 'law')!;
    expect([n(split.costsAmount), n(split.interestAmount), n(split.principal)]).toEqual([10, 3, 7]);
    // Teilbetrag deckt nur einen Teil der Kosten
    const small = allocatePayment(c, D(4), 'law')!;
    expect([n(small.costsAmount), n(small.interestAmount), n(small.principal)]).toEqual([4, 0, 0]);
    // Grenze: gesamte Forderung
    expect(allocatePayment(c, D(1013), 'law')).not.toBeNull();
    expect(allocatePayment(c, D(1013.01), 'law')).toBeNull();
  });

  it('Bestimmung „nur Rechnung“: Kosten bleiben offen', () => {
    const c = invoiceClaims(input({ dunningNotices: [notice(1, 10, 0, 3)] }));
    const split = allocatePayment(c, D(1000), 'principal')!;
    expect(n(split.costsAmount)).toBe(0);
    expect(allocatePayment(c, D(1000.01), 'principal')).toBeNull();
    const after = invoiceClaims(input({ dunningNotices: [notice(1, 10, 0, 3)], payments: [payment(1000)] }));
    expect(n(after.principalOpen)).toBe(0);
    expect(n(after.chargesOpen)).toBe(13);
  });

  it('bereits gezahlte Anteile und Erlass mindern erst Kosten, dann Zinsen', () => {
    const c = invoiceClaims(
      input({
        dunningNotices: [notice(1, 10, 0, 3), notice(2, 5, 0, 8)],
        payments: [payment(12, 12, 0)],
        chargeWaivers: [{ amount: D(5) }],
      }),
    );
    // Kosten 15 - 12 gezahlt = 3, Erlass 5: Kosten 0, Zinsen 8 - 2 = 6
    expect(n(c.costsOpen)).toBe(0);
    expect(n(c.interestOpen)).toBe(6);
    expect(n(c.principalOpen)).toBe(1000);
    expect(n(c.principalPaid)).toBe(0);
  });

  it('Erlass größer als die Kosten wird nicht negativ', () => {
    const c = invoiceClaims(
      input({ dunningNotices: [notice(1, 5, 0, 0)], chargeWaivers: [{ amount: D(50) }] }),
    );
    expect(n(c.chargesOpen)).toBe(0);
    expect(n(c.totalOpen)).toBe(1000);
  });
});
