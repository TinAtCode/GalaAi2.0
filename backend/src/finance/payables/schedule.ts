import { discountedAmount } from './match';

const DEFAULT_TERM_DAYS = 14; // ohne Fälligkeit: 14 Tage nach Rechnungsdatum

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Wann und wie viel wird eine offene Eingangsrechnung voraussichtlich
// bezahlt? Mit Skonto, solange die Frist läuft; sonst zur Fälligkeit. Schon
// Fälliges zählt ab heute.
export function plannedPayment(
  p: {
    amount: string;
    invoiceDate: string | null;
    dueDate: string | null;
    discountPercent: string | null;
    discountUntil: string | null;
  },
  today: string,
): { date: string; amount: string; withDiscount: boolean; overdue: boolean } {
  const discounted = discountedAmount(p.amount, p.discountPercent);
  if (discounted && p.discountUntil && p.discountUntil >= today) {
    return { date: p.discountUntil, amount: discounted, withDiscount: true, overdue: false };
  }
  const due = p.dueDate ?? (p.invoiceDate ? addDays(p.invoiceDate, DEFAULT_TERM_DAYS) : today);
  return { date: due < today ? today : due, amount: p.amount, withDiscount: false, overdue: due < today };
}
