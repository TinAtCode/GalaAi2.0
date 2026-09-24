import { RecurringInterval } from '@prisma/client';
import { addCalendarDays, calendarDaysBetween } from '../common/time-zone';
import { addMonths, MONTHS_PER_INTERVAL } from '../finance/recurring';

// Kalenderlogik der Pflegeverträge – alle Tage als JJJJ-MM-TT.

export const dayOf = (date: Date) => date.toISOString().slice(0, 10);

export interface BillingPeriod {
  start: string;
  end: string;
  // nur bei einem am Vertragsende gekürzten Zeitraum: berechnete von vollen Tagen
  share?: { days: number; of: number };
}

// Nächster abzurechnender Zeitraum: direkt nach dem zuletzt abgerechneten
// (Rechnungen, die nicht storniert sind), sonst ab Vertragsbeginn. Endet der
// Vertrag vorher, wird der Zeitraum am Vertragsende gekürzt und anteilig
// nach Tagen berechnet.
export function nextBillingPeriod(
  contract: { startDate: string; endDate: string | null; billingInterval: RecurringInterval },
  billedPeriodEnds: string[],
): BillingPeriod | null {
  const lastEnd = billedPeriodEnds.reduce<string | null>((max, d) => (!max || d > max ? d : max), null);
  const start = lastEnd ? addCalendarDays(lastEnd, 1) : contract.startDate;
  if (contract.endDate && start > contract.endDate) return null;
  const fullEnd = addCalendarDays(addMonths(start, MONTHS_PER_INTERVAL[contract.billingInterval]), -1);
  if (!contract.endDate || fullEnd <= contract.endDate) return { start, end: fullEnd };
  const end = contract.endDate;
  return {
    start,
    end,
    share: { days: calendarDaysBetween(start, end) + 1, of: calendarDaysBetween(start, fullEnd) + 1 },
  };
}

// Im Voraus: fällig ab Beginn des Zeitraums; nachträglich: nach dessen Ende
export function isBillingDue(period: BillingPeriod, billInAdvance: boolean, today: string) {
  return billInAdvance ? period.start <= today : period.end < today;
}

// Saison als Monate 1–12, auch über den Jahreswechsel (z.B. 11–2 für den Winterdienst)
export function inSeason(day: string, from: number, to: number) {
  const month = Number(day.slice(5, 7));
  return from <= to ? month >= from && month <= to : month >= from || month <= to;
}

// Termine eines Einsatzes bis einschließlich `until` (und bis Vertragsende);
// außerhalb der Saison fällt der Termin aus, der Rhythmus läuft weiter.
export function taskOccurrences(
  task: { nextDue: string; everyWeeks: number; seasonFrom: number; seasonTo: number },
  until: string,
  contractEnd: string | null,
): { days: string[]; nextDue: string } {
  const last = contractEnd && contractEnd < until ? contractEnd : until;
  const days: string[] = [];
  let day = task.nextDue;
  const step = Math.max(1, task.everyWeeks) * 7;
  while (day <= last) {
    if (inSeason(day, task.seasonFrom, task.seasonTo)) days.push(day);
    day = addCalendarDays(day, step);
  }
  return { days, nextDue: day };
}
