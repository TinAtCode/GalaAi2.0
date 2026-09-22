import { calculateOvertime } from '../src/time-entries/overtime';

describe('calculateOvertime', () => {
  it('keine Überstunden, wenn genau die Regelarbeitszeit gearbeitet wurde', () => {
    const result = calculateOvertime(8 * 60, 8);
    expect(result.overtimeMinutes).toBe(0);
    expect(result.regularMinutes).toBe(480);
  });

  it('berechnet Überstunden korrekt, wenn länger gearbeitet wurde', () => {
    const result = calculateOvertime(9.5 * 60, 8); // 9,5h gearbeitet, 8h Regelarbeitszeit
    expect(result.overtimeMinutes).toBe(90); // 1,5h = 90 Min
    expect(result.workedMinutes).toBe(570);
  });

  it('liefert 0 Überstunden bei weniger als der Regelarbeitszeit (keine negativen Werte)', () => {
    const result = calculateOvertime(5 * 60, 8);
    expect(result.overtimeMinutes).toBe(0);
  });

  it('funktioniert mit einer krummen Regelarbeitszeit (z.B. 7,5h Teilzeit)', () => {
    const result = calculateOvertime(8 * 60, 7.5);
    expect(result.regularMinutes).toBe(450);
    expect(result.overtimeMinutes).toBe(30);
  });
});
