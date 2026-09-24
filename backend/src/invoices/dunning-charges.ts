import { Prisma } from '@prisma/client';
import { addCalendarDays, calendarDaysBetween } from '../common/time-zone';

// Mahngebühren, Verzugszinsen (§ 288 Abs. 1/2 BGB) und Verzugspauschale
// (§ 288 Abs. 5 BGB) zu einer neuen Mahnstufe. Alles optional, Standard aus.
//
// Verzugsbeginn (§ 286 BGB): am Tag nach der ersten Mahnung (auch eine
// Zahlungserinnerung ist eine Mahnung); bei Geschäftskunden spätestens 30 Tage
// nach Fälligkeit (§ 286 Abs. 3 – bei Verbrauchern nur mit Hinweis auf der
// Rechnung, den die Rechnungen nicht enthalten).
// Zinssatz: Basiszinssatz + 5 Prozentpunkte (Verbraucher) bzw. + 9
// (Geschäftskunden), taggenau auf den offenen Betrag, Jahr = 365 Tage.

export const LUMP_SUM = new Prisma.Decimal(40);
const ZERO = new Prisma.Decimal(0);

export interface DunningSettings {
  fees: [Prisma.Decimal, Prisma.Decimal, Prisma.Decimal]; // je Stufe
  interest: boolean;
  baseInterestRate: Prisma.Decimal | null; // % p. a., kann negativ sein
  lumpSum: boolean;
}

export interface DunningChargesInput {
  level: number;
  today: string; // Datum der neuen Mahnung
  dueDay: string; // Fälligkeit der Rechnung
  open: Prisma.Decimal;
  isBusiness: boolean;
  previous: { level: number; issuedOn: string; lumpSum: Prisma.Decimal }[];
  settings: DunningSettings;
}

export interface DunningCharges {
  fee: Prisma.Decimal;
  interest: Prisma.Decimal;
  interestRate: Prisma.Decimal | null;
  interestFrom: string | null;
  lumpSum: Prisma.Decimal;
}

export function defaultInterestFrom(input: Pick<DunningChargesInput, 'dueDay' | 'isBusiness' | 'previous'>) {
  const first = input.previous.find((p) => p.level === 1);
  const candidates = [
    first ? addCalendarDays(first.issuedOn, 1) : null,
    input.isBusiness ? addCalendarDays(input.dueDay, 31) : null,
  ].filter((d): d is string => d !== null);
  return candidates.sort()[0] ?? null;
}

export function dunningCharges(input: DunningChargesInput): DunningCharges {
  const { settings } = input;
  const fee = settings.fees[input.level - 1] ?? ZERO;
  const start = defaultInterestFrom(input);
  const inDefault = start !== null && start <= input.today;

  let interest = ZERO;
  let interestRate: Prisma.Decimal | null = null;
  if (settings.interest && settings.baseInterestRate !== null && inDefault) {
    interestRate = settings.baseInterestRate.plus(input.isBusiness ? 9 : 5);
    // Tage einschließlich Beginn und Mahndatum
    const days = calendarDaysBetween(start!, input.today) + 1;
    interest = interestRate.greaterThan(0)
      ? input.open
          .times(interestRate)
          .dividedBy(100)
          .times(days)
          .dividedBy(365)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : ZERO;
  }

  const alreadyCharged = input.previous.some((p) => p.lumpSum.greaterThan(0));
  const lumpSum = settings.lumpSum && input.isBusiness && inDefault && !alreadyCharged ? LUMP_SUM : ZERO;

  return {
    fee,
    interest,
    interestRate: interest.greaterThan(0) ? interestRate : null,
    interestFrom: interest.greaterThan(0) ? start : null,
    lumpSum,
  };
}
