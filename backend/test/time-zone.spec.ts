import { BadRequestException } from '@nestjs/common';
import {
  addCalendarDays,
  calendarDaysBetween,
  dayRangeInZone,
  formatTimeInZone,
  isValidDay,
  localDayString,
  parseDayParam,
} from '../src/common/time-zone';

describe('Tagesgrenzen in der Zeitzone der Firma', () => {
  it('ordnet 00:30 Uhr deutscher Zeit dem richtigen Tag zu (Sommerzeit, UTC+2)', () => {
    // 22.09.2026 00:30 in Berlin = 21.09.2026 22:30 UTC
    const { start, end } = dayRangeInZone(new Date('2026-09-21T22:30:00Z'), 'Europe/Berlin');
    expect(start.toISOString()).toBe('2026-09-21T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-22T22:00:00.000Z');
  });

  it('berücksichtigt die Winterzeit (UTC+1)', () => {
    const { start, end } = dayRangeInZone(new Date('2026-01-15T10:00:00Z'), 'Europe/Berlin');
    expect(start.toISOString()).toBe('2026-01-14T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-15T23:00:00.000Z');
  });

  it('der Tag der Zeitumstellung im März hat 23 Stunden, im Oktober 25', () => {
    const march = dayRangeInZone(new Date('2026-03-29T12:00:00Z'), 'Europe/Berlin');
    expect(march.start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect((march.end.getTime() - march.start.getTime()) / 3600000).toBe(23);

    const october = dayRangeInZone(new Date('2026-10-25T12:00:00Z'), 'Europe/Berlin');
    expect(october.start.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect((october.end.getTime() - october.start.getTime()) / 3600000).toBe(25);
  });

  it('formatiert Uhrzeiten in der Zeitzone der Firma statt in UTC', () => {
    expect(formatTimeInZone(new Date('2026-09-22T07:00:00Z'), 'Europe/Berlin')).toBe('09:00');
  });

  it('versteht ?date=2026-09-22 als Kalendertag und lehnt Unsinn ab', () => {
    const { start } = dayRangeInZone(parseDayParam('2026-09-22'), 'Europe/Berlin');
    expect(start.toISOString()).toBe('2026-09-21T22:00:00.000Z');
    expect(() => parseDayParam('gestern')).toThrow(BadRequestException);
  });
});

describe('Kalendertage', () => {
  it('Zahlungsziel über die Zeitumstellung: in Kalendertagen, nicht 24-Stunden-Blöcken', () => {
    // 13.10. 00:30 Uhr Sommerzeit (= 12.10. 22:30 UTC) + 14 Tage = 27.10.
    const issued = new Date('2026-10-12T22:30:00Z');
    expect(localDayString(issued, 'Europe/Berlin')).toBe('2026-10-13');
    expect(addCalendarDays(localDayString(issued, 'Europe/Berlin'), 14)).toBe('2026-10-27');
    // die alte Rechnung (+14 × 24 h) landete in Berlin auf dem 26.10.
    const naive = new Date(issued.getTime() + 14 * 24 * 3600 * 1000);
    expect(localDayString(naive, 'Europe/Berlin')).toBe('2026-10-26');
  });

  it('Abstand, Monats- und Jahreswechsel, ungültige Daten', () => {
    expect(calendarDaysBetween('2026-10-27', '2026-11-02')).toBe(6);
    expect(calendarDaysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(isValidDay('2026-09-23')).toBe(true);
    expect(isValidDay('2026-02-30')).toBe(false);
    expect(isValidDay('2026-13-01')).toBe(false);
    expect(isValidDay('23.09.2026')).toBe(false);
  });
});
