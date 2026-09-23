import { VatTreatment } from '@prisma/client';

// Pflichthinweise für Belege ohne Umsatzsteuer (§ 14a Abs. 5 und § 19 UStG).
export const VAT_TREATMENT_NOTES: Record<VatTreatment, string | null> = {
  standard: null,
  small_business: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
  reverse_charge: 'Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG).',
};

// Kleinunternehmer stellen immer ohne Umsatzsteuer aus; sonst gilt die
// Wahl am Angebot. Ohne Umsatzsteuer ist der Satz immer 0.
export function resolveVatTreatment(
  smallBusiness: boolean,
  requested: VatTreatment | undefined,
): VatTreatment {
  if (smallBusiness) return 'small_business';
  return requested === 'reverse_charge' ? 'reverse_charge' : 'standard';
}
