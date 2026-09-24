import { dayRangeInZone, localTimeInZone } from './time-zone';

describe('Zeitzone', () => {
  const tz = 'Europe/Berlin';

  it('Ortszeit an einem Kalendertag, auch am Tag der Zeitumstellung', () => {
    expect(localTimeInZone('2026-01-15', 8 * 60, tz).toISOString()).toBe('2026-01-15T07:00:00.000Z');
    expect(localTimeInZone('2026-07-15', 8 * 60, tz).toISOString()).toBe('2026-07-15T06:00:00.000Z');
    // 29.3.2026: um 2 Uhr auf Sommerzeit – 8 Uhr ist 6 Uhr UTC (nicht 7 Uhr)
    expect(localTimeInZone('2026-03-29', 8 * 60, tz).toISOString()).toBe('2026-03-29T06:00:00.000Z');
    // 25.10.2026: um 3 Uhr zurück auf Winterzeit – 8 Uhr ist 7 Uhr UTC
    expect(localTimeInZone('2026-10-25', 8 * 60, tz).toISOString()).toBe('2026-10-25T07:00:00.000Z');
    expect(localTimeInZone('2026-10-25', 0, tz).toISOString()).toBe('2026-10-24T22:00:00.000Z');
  });

  it('Tagesgrenzen: 23 bzw. 25 Stunden an den Tagen der Umstellung', () => {
    const hours = (day: string) => {
      const { start, end } = dayRangeInZone(new Date(`${day}T12:00:00Z`), tz);
      return (end.getTime() - start.getTime()) / 3_600_000;
    };
    expect(hours('2026-03-29')).toBe(23);
    expect(hours('2026-10-25')).toBe(25);
    expect(hours('2026-06-01')).toBe(24);
  });
});
