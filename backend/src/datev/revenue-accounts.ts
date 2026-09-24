import { BadRequestException } from '@nestjs/common';
import { DatevChart, Prisma, VatTreatment } from '@prisma/client';

export type RevenueAccountKey = 'standard19' | 'standard7' | 'smallBusiness' | 'reverseCharge';

// Erlöskonten der DATEV-Standardkontenrahmen. 8400/4400 und 8300/4300 sind
// Automatikkonten (die Umsatzsteuer bucht DATEV selbst), daher ohne
// BU-Schlüssel. Abweichungen lassen sich je Firma einstellen.
export const DEFAULT_REVENUE_ACCOUNTS: Record<DatevChart, Record<RevenueAccountKey, number>> = {
  SKR03: { standard19: 8400, standard7: 8300, smallBusiness: 8195, reverseCharge: 8337 },
  SKR04: { standard19: 4400, standard7: 4300, smallBusiness: 4185, reverseCharge: 4337 },
};

export function revenueAccounts(chart: DatevChart, overrides: Prisma.JsonValue | null) {
  const custom = (
    overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {}
  ) as Record<string, unknown>;
  const result = { ...DEFAULT_REVENUE_ACCOUNTS[chart] };
  for (const key of Object.keys(result) as RevenueAccountKey[]) {
    if (typeof custom[key] === 'number') result[key] = custom[key];
  }
  return result;
}

// Erlöskonto einer Rechnung nach umsatzsteuerlicher Behandlung und Satz.
export function revenueAccountFor(
  accounts: Record<RevenueAccountKey, number>,
  invoice: { number: string | null; vatTreatment: VatTreatment; vatRate: Prisma.Decimal },
): number {
  if (invoice.vatTreatment === 'small_business') return accounts.smallBusiness;
  if (invoice.vatTreatment === 'reverse_charge') return accounts.reverseCharge;
  if (invoice.vatRate.equals(19)) return accounts.standard19;
  if (invoice.vatRate.equals(7)) return accounts.standard7;
  throw new BadRequestException(
    `Rechnung ${invoice.number}: für ${invoice.vatRate.toString()} % Umsatzsteuer gibt es kein Erlöskonto im DATEV-Export (nur 19 % und 7 %).`,
  );
}

// Geldkonten für Zahlungseingänge (DATEV-Standard): Bank, Kasse und für
// sonstige Zahlungen (Verrechnung, PayPal …) das Geldtransitkonto – von dort
// bucht die Kanzlei um, statt dass das Bankkonto nicht mehr zum Auszug passt.
export type MoneyAccountKey = 'bank' | 'cash' | 'other';
export const DEFAULT_MONEY_ACCOUNTS: Record<DatevChart, Record<MoneyAccountKey, number>> = {
  SKR03: { bank: 1200, cash: 1000, other: 1360 },
  SKR04: { bank: 1800, cash: 1600, other: 1460 },
};

// Abweichungen stehen in derselben Einstellung wie die Erlöskonten
export function moneyAccounts(chart: DatevChart, overrides: Prisma.JsonValue | null) {
  const custom = (
    overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {}
  ) as Record<string, unknown>;
  const result = { ...DEFAULT_MONEY_ACCOUNTS[chart] };
  for (const key of Object.keys(result) as MoneyAccountKey[]) {
    if (typeof custom[key] === 'number') result[key] = custom[key];
  }
  return result;
}

// Erträge aus Mahnkosten (Gebühren, Pauschale; nicht umsatzsteuerbar) und
// Verzugszinsen: Zahlungsanteile, die nach § 367 BGB darauf verrechnet sind
export type ChargeAccountKey = 'dunningCosts' | 'interest';
export const DEFAULT_CHARGE_ACCOUNTS: Record<DatevChart, Record<ChargeAccountKey, number>> = {
  SKR03: { dunningCosts: 2700, interest: 2650 },
  SKR04: { dunningCosts: 4830, interest: 7100 },
};

export function chargeAccounts(chart: DatevChart, overrides: Prisma.JsonValue | null) {
  const custom = (
    overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {}
  ) as Record<string, unknown>;
  const result = { ...DEFAULT_CHARGE_ACCOUNTS[chart] };
  for (const key of Object.keys(result) as ChargeAccountKey[]) {
    if (typeof custom[key] === 'number') result[key] = custom[key];
  }
  return result;
}
