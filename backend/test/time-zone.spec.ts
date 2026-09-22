import { BadRequestException } from '@nestjs/common';
import { dayRangeInZone, formatTimeInZone, parseDayParam } from '../src/common/time-zone';

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
