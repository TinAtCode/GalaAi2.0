import { BadRequestException } from '@nestjs/common';

// Tagesgrenzen ("Mein Tag", Überstunden, Terminkollision) müssen in der
// Zeitzone der Firma berechnet werden, nicht in der des Servers. Ein Server
// in Docker läuft typischerweise in UTC – mit setHours(0) landete ein Termin
// um 00:30 Uhr deutscher Zeit sonst am Vortag.
export const DEFAULT_TIME_ZONE = 'Europe/Berlin';

// Kalenderdatum (Jahr/Monat/Tag) eines Zeitpunkts in einer Zeitzone.
function calendarDateInZone(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

// Abstand der Zeitzone zu UTC (in ms) zum angegebenen Zeitpunkt – berücksichtigt
// Sommer-/Winterzeit, weil Intl die Uhrzeit für genau diesen Zeitpunkt liefert.
function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wallClockAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return wallClockAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

// 00:00 Uhr Ortszeit eines Kalendertags als UTC-Zeitpunkt.
function startOfLocalDay(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  // Zweimal korrigieren, falls um Mitternacht gerade die Zeit umgestellt wird.
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

// Beginn (inklusive) und Ende (exklusive) des Kalendertags, in den der
// Zeitpunkt in der angegebenen Zeitzone fällt. An Tagen mit Zeitumstellung
// ist der Tag korrekt 23 bzw. 25 Stunden lang.
export function dayRangeInZone(instant: Date, timeZone: string): { start: Date; end: Date } {
  const { year, month, day } = calendarDateInZone(instant, timeZone);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: startOfLocalDay(year, month, day, timeZone),
    end: startOfLocalDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone),
  };
}

export function formatTimeInZone(instant: Date, timeZone: string): string {
  return instant.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone });
}

// ?date=-Parameter: "2026-09-22" meint den Kalendertag, nicht UTC-Mitternacht.
// 12:00 UTC liegt für jede Zeitzone zwischen UTC-11 und UTC+11 auf genau
// diesem Kalendertag. Ohne Parameter gilt "jetzt".
export function parseDayParam(value?: string): Date {
  if (!value) return new Date();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('Ungültiges Datum – erwartet z.B. 2026-09-22.');
  }
  return parsed;
}
