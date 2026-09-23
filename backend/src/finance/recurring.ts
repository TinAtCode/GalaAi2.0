import { Prisma } from '@prisma/client';
import { calendarDaysBetween } from '../common/time-zone';
import { normalizeIban, normalizeName } from './categorize';

export type Interval = 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';

// Abstand in Tagen mit Toleranz (Monatsenden, Wochenenden, Feiertage)
const INTERVALS: { interval: Interval; days: number; tolerance: number; months: number }[] = [
  { interval: 'monthly', days: 30, tolerance: 6, months: 1 },
  { interval: 'quarterly', days: 91, tolerance: 12, months: 3 },
  { interval: 'halfyearly', days: 182, tolerance: 18, months: 6 },
  { interval: 'yearly', days: 365, tolerance: 25, months: 12 },
];

export const MONTHS_PER_INTERVAL: Record<Interval, number> = {
  monthly: 1,
  quarterly: 3,
  halfyearly: 6,
  yearly: 12,
};

// Datum um n Monate verschieben; Monatsende bleibt Monatsende (31.01. -> 28.02.)
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

export interface DebitForDetection {
  bookingDate: string; // JJJJ-MM-TT
  amount: Prisma.Decimal;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  categoryId: string | null;
}

export interface RecurringSuggestion {
  key: string; // IBAN oder normalisierter Name
  name: string;
  counterpartyIban: string | null;
  interval: Interval;
  amount: Prisma.Decimal; // Durchschnitt, auf Cent
  occurrences: number;
  lastDate: string;
  nextDue: string;
  categoryId: string | null;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Wiederkehrende Abbuchungen erkennen: gleiche Gegenpartei (IBAN, sonst
// Name), mindestens drei Buchungen, Beträge höchstens 10 % vom Mittel
// entfernt und ein regelmäßiger Abstand (monatlich bis jährlich; jährlich
// genügen zwei Buchungen).
export function detectRecurring(debits: DebitForDetection[]): RecurringSuggestion[] {
  const groups = new Map<string, DebitForDetection[]>();
  for (const d of debits) {
    const key = normalizeIban(d.counterpartyIban) || normalizeName(d.counterpartyName);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const result: RecurringSuggestion[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
    if (sorted.length < 2) continue;
    const gaps = sorted.slice(1).map((d, i) => calendarDaysBetween(sorted[i].bookingDate, d.bookingDate));
    const gap = median(gaps);
    const match = INTERVALS.find((i) => Math.abs(gap - i.days) <= i.tolerance);
    if (!match) continue;
    if (sorted.length < (match.interval === 'yearly' ? 2 : 3)) continue;
    // alle Abstände müssen zum Rhythmus passen (einzelne Ausreißer: kein Muster)
    if (gaps.some((g) => Math.abs(g - match.days) > match.tolerance * 2)) continue;
    const amounts = sorted.map((d) => Number(d.amount));
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    if (amounts.some((a) => Math.abs(a - mean) > mean * 0.1)) continue;
    const last = sorted[sorted.length - 1];
    const categories = sorted.map((d) => d.categoryId).filter(Boolean);
    result.push({
      key,
      name: last.counterpartyName ?? key,
      counterpartyIban: normalizeIban(last.counterpartyIban) || null,
      interval: match.interval,
      amount: new Prisma.Decimal(mean).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      occurrences: sorted.length,
      lastDate: last.bookingDate,
      nextDue: addMonths(last.bookingDate, match.months),
      categoryId: categories.length ? categories[categories.length - 1]! : null,
    });
  }
  return result.sort((a, b) => Number(b.amount) - Number(a.amount));
}

// Fälligkeiten einer wiederkehrenden Zahlung in einem Zeitraum [from, to].
// Jede Fälligkeit wird vom Stichtag aus berechnet (Stichtag + k Intervalle),
// damit ein Monatsende nicht nach und nach auf den 28. rutscht.
export function dueDatesBetween(
  payment: { nextDue: string; interval: Interval; endDate: string | null },
  from: string,
  to: string,
): string[] {
  const months = MONTHS_PER_INTERVAL[payment.interval];
  const monthIndex = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
  const first = Math.floor((monthIndex(from) - monthIndex(payment.nextDue)) / months) - 1;
  const last = Math.ceil((monthIndex(to) - monthIndex(payment.nextDue)) / months) + 1;
  const dates: string[] = [];
  for (let k = first; k <= last; k++) {
    const day = addMonths(payment.nextDue, k * months);
    // erst ab der nächsten Fälligkeit (Zahlungen, die später beginnen)
    if (day < payment.nextDue) continue;
    if (day >= from && day <= to && (!payment.endDate || day <= payment.endDate)) dates.push(day);
  }
  return dates;
}
