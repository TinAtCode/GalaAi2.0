import { normalizeIban, normalizeName } from '../categorize';

// Welche Abbuchung bezahlt welche Eingangsrechnung? Der Betrag muss passen –
// genau oder abzüglich Skonto (bis wenige Tage nach der Skontofrist). Dazu
// zählen Rechnungsnummer im Verwendungszweck, gleiche IBAN und der Name.

export interface MatchPayable {
  id: string;
  supplierName: string;
  supplierIban: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  // Abbuchungen davor gehören sicher nicht zu dieser Rechnung (ohne
  // Rechnungsdatum: vier Wochen vor der Fälligkeit bzw. dem Erfassen)
  earliest: string;
  amount: string;
  discountPercent: string | null;
  discountUntil: string | null;
  // von Hand verworfene Abbuchungen ("Wieder öffnen")
  rejected?: string[];
}

export interface MatchDebit {
  id: string;
  bookingDate: string;
  amount: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  remittance: string | null;
}

export type MatchReason = 'amount' | 'discount' | 'number' | 'iban' | 'name';

export interface Match {
  payableId: string;
  debit: MatchDebit;
  score: number;
  reasons: MatchReason[];
  // sicher genug, um ohne Rückfrage als bezahlt zu verbuchen
  auto: boolean;
}

const cents = (value: string) => Math.round(Number(value) * 100);
const alnum = (value: string | null) => (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const DISCOUNT_GRACE_DAYS = 3; // Buchung kann ein paar Tage nach der Überweisung kommen

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Betrag abzüglich Skonto, kaufmännisch auf Cent gerundet
// frühestes Buchungsdatum einer passenden Abbuchung
export function earliestPayment(p: {
  invoiceDate: string | null;
  dueDate: string | null;
  createdAt: string;
}) {
  if (p.invoiceDate) return addDays(p.invoiceDate, -DISCOUNT_GRACE_DAYS);
  // ohne Rechnungsdatum knapp: sonst träfe z.B. die Miete des Vormonats
  if (p.dueDate) return addDays(p.dueDate, -28);
  return addDays(p.createdAt, -28);
}

export function discountedAmount(amount: string, percent: string | null): string | null {
  if (!percent || Number(percent) <= 0) return null;
  return (Math.round(cents(amount) * (1 - Number(percent) / 100)) / 100).toFixed(2);
}

export function scoreMatch(
  p: MatchPayable,
  d: MatchDebit,
): Omit<Match, 'payableId' | 'debit' | 'auto'> | null {
  if (d.bookingDate < p.earliest || p.rejected?.includes(d.id)) return null;
  const reasons: MatchReason[] = [];
  let score = 0;
  const discounted = discountedAmount(p.amount, p.discountPercent);
  if (cents(d.amount) === cents(p.amount)) {
    reasons.push('amount');
    score += 2;
  } else if (
    discounted &&
    cents(d.amount) === cents(discounted) &&
    (!p.discountUntil || d.bookingDate <= addDays(p.discountUntil, DISCOUNT_GRACE_DAYS))
  ) {
    reasons.push('discount');
    score += 2;
  } else {
    return null;
  }
  const number = alnum(p.invoiceNumber);
  if (number.length >= 3 && alnum(d.remittance).includes(number)) {
    reasons.push('number');
    score += 3;
  }
  const iban = normalizeIban(p.supplierIban);
  if (iban && iban === normalizeIban(d.counterpartyIban)) {
    reasons.push('iban');
    score += 2;
  }
  // erstes markantes Wort des Lieferanten im Empfängernamen
  const word = normalizeName(p.supplierName)
    .split(' ')
    .find((w) => w.length >= 4);
  if (word && normalizeName(d.counterpartyName).split(' ').includes(word)) {
    reasons.push('name');
    score += 1;
  }
  // Betrag allein reicht nicht
  return score >= 3 ? { score, reasons } : null;
}

// Beste Zuordnung je Rechnung, jede Abbuchung höchstens einmal (die stärkste
// Paarung zuerst). Automatisch nur mit Rechnungsnummer und eindeutig.
export function bestMatches(payables: MatchPayable[], debits: MatchDebit[]): Match[] {
  const pairs: Match[] = [];
  for (const p of payables) {
    for (const d of debits) {
      const scored = scoreMatch(p, d);
      if (scored) pairs.push({ payableId: p.id, debit: d, ...scored, auto: false });
    }
  }
  // bei gleicher Punktzahl die jüngere Abbuchung
  pairs.sort((a, b) => b.score - a.score || b.debit.bookingDate.localeCompare(a.debit.bookingDate));
  const usedPayables = new Set<string>();
  const usedDebits = new Set<string>();
  const result: Match[] = [];
  for (const pair of pairs) {
    if (usedPayables.has(pair.payableId) || usedDebits.has(pair.debit.id)) continue;
    usedPayables.add(pair.payableId);
    usedDebits.add(pair.debit.id);
    // eindeutig: keine zweite Paarung mit gleicher Punktzahl für Rechnung oder Abbuchung
    const rivals = pairs.filter(
      (other) =>
        other !== pair &&
        other.score === pair.score &&
        (other.payableId === pair.payableId || other.debit.id === pair.debit.id),
    );
    result.push({ ...pair, auto: pair.reasons.includes('number') && rivals.length === 0 });
  }
  return result;
}
