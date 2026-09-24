import { Prisma } from '@prisma/client';

// Forderung aus einer Rechnung: Rechnungsbetrag plus Mahnkosten (Gebühren und
// Pauschale je Mahnstufe) und Verzugszinsen (die jüngste Mahnung enthält die
// Zinsen bis zu ihrem Datum). Zahlungen werden nach § 367 BGB zuerst auf die
// Kosten, dann auf die Zinsen und zuletzt auf den Rechnungsbetrag verrechnet;
// erlassene Beträge mindern erst die Kosten, dann die Zinsen.

const ZERO = new Prisma.Decimal(0);
const sum = <T>(items: T[], value: (item: T) => Prisma.Decimal) =>
  items.reduce((total, item) => total.plus(value(item)), ZERO);
const max0 = (d: Prisma.Decimal) => (d.isNegative() ? ZERO : d);
const min = (a: Prisma.Decimal, b: Prisma.Decimal) => (a.lessThan(b) ? a : b);

export interface ClaimsInput {
  totalGross: Prisma.Decimal;
  payments: { amount: Prisma.Decimal; costsAmount: Prisma.Decimal; interestAmount: Prisma.Decimal }[];
  dunningNotices: { level: number; fee: Prisma.Decimal; lumpSum: Prisma.Decimal; interest: Prisma.Decimal }[];
  chargeWaivers: { amount: Prisma.Decimal }[];
}

export interface Claims {
  principalPaid: Prisma.Decimal;
  principalOpen: Prisma.Decimal;
  costs: Prisma.Decimal; // Mahngebühren und Pauschale
  interest: Prisma.Decimal;
  waived: Prisma.Decimal;
  costsOpen: Prisma.Decimal;
  interestOpen: Prisma.Decimal;
  chargesOpen: Prisma.Decimal; // Kosten und Zinsen offen
  totalOpen: Prisma.Decimal; // alles zusammen
}

export function invoiceClaims(input: ClaimsInput): Claims {
  const costs = sum(input.dunningNotices, (n) => n.fee.plus(n.lumpSum));
  const latest = input.dunningNotices.reduce<ClaimsInput['dunningNotices'][number] | null>(
    (last, n) => (!last || n.level > last.level ? n : last),
    null,
  );
  const interest = latest?.interest ?? ZERO;
  const waived = sum(input.chargeWaivers, (w) => w.amount);
  const costsPaid = sum(input.payments, (p) => p.costsAmount);
  const interestPaid = sum(input.payments, (p) => p.interestAmount);
  const principalPaid = sum(input.payments, (p) => p.amount.minus(p.costsAmount).minus(p.interestAmount));

  let costsOpen = max0(costs.minus(costsPaid));
  let interestOpen = max0(interest.minus(interestPaid));
  let waiver = waived;
  const waiveCosts = min(waiver, costsOpen);
  costsOpen = costsOpen.minus(waiveCosts);
  waiver = waiver.minus(waiveCosts);
  interestOpen = max0(interestOpen.minus(waiver));

  const principalOpen = max0(input.totalGross.minus(principalPaid));
  const chargesOpen = costsOpen.plus(interestOpen);
  return {
    principalPaid,
    principalOpen,
    costs,
    interest,
    waived,
    costsOpen,
    interestOpen,
    chargesOpen,
    totalOpen: principalOpen.plus(chargesOpen),
  };
}

// Aufteilung einer neuen Zahlung: 'law' nach § 367 BGB (erst Kosten, dann
// Zinsen), 'principal' nur auf den Rechnungsbetrag (Bestimmung des Kunden)
export type PaymentAllocation = 'law' | 'principal';

export function allocatePayment(claims: Claims, amount: Prisma.Decimal, allocation: PaymentAllocation) {
  const limit = allocation === 'law' ? claims.totalOpen : claims.principalOpen;
  if (amount.greaterThan(limit)) return null;
  if (allocation === 'principal') return { costsAmount: ZERO, interestAmount: ZERO, principal: amount };
  const costsAmount = min(amount, claims.costsOpen);
  const interestAmount = min(amount.minus(costsAmount), claims.interestOpen);
  return { costsAmount, interestAmount, principal: amount.minus(costsAmount).minus(interestAmount), limit };
}
