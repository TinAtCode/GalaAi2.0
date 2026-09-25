import { addMonths, statusFromDamages } from '../src/equipment/equipment.service';

describe('Geräte', () => {
  it('rückt Fälligkeiten um Monate weiter und kappt am Monatsende', () => {
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });

  it('nimmt den schlimmsten offenen Schaden als Zustand', () => {
    expect(statusFromDamages([])).toBe('ready');
    expect(statusFromDamages(['minor'])).toBe('ready');
    expect(statusFromDamages(['minor', 'limited'])).toBe('limited');
    expect(statusFromDamages(['limited', 'unusable', 'minor'])).toBe('broken');
  });
});
