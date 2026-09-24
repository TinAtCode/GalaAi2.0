import { inSeason, isBillingDue, nextBillingPeriod, taskOccurrences } from './contract-schedule';

describe('Pflegeverträge: Kalender', () => {
  const contract = { startDate: '2026-01-31', endDate: null, billingInterval: 'monthly' as const };

  it('Abrechnungszeitraum nach dem letzten, Monatsende bleibt Monatsende', () => {
    expect(nextBillingPeriod(contract, [])).toEqual({ start: '2026-01-31', end: '2026-02-27' });
    expect(nextBillingPeriod(contract, ['2026-02-27'])).toEqual({ start: '2026-02-28', end: '2026-03-27' });
    const quarterly = { startDate: '2026-04-01', endDate: null, billingInterval: 'quarterly' as const };
    expect(nextBillingPeriod(quarterly, ['2026-06-30', '2026-09-30'])).toEqual({
      start: '2026-10-01',
      end: '2026-12-31',
    });
  });

  it('kürzt am Vertragsende und endet danach', () => {
    const ending = { startDate: '2026-01-01', endDate: '2026-02-15', billingInterval: 'monthly' as const };
    expect(nextBillingPeriod(ending, ['2026-01-31'])).toEqual({ start: '2026-02-01', end: '2026-02-15' });
    expect(nextBillingPeriod(ending, ['2026-02-15'])).toBeNull();
  });

  it('fällig im Voraus oder nachträglich', () => {
    const period = { start: '2026-03-01', end: '2026-03-31' };
    expect(isBillingDue(period, true, '2026-03-01')).toBe(true);
    expect(isBillingDue(period, true, '2026-02-28')).toBe(false);
    expect(isBillingDue(period, false, '2026-03-31')).toBe(false);
    expect(isBillingDue(period, false, '2026-04-01')).toBe(true);
  });

  it('Saison, auch über den Jahreswechsel', () => {
    expect(inSeason('2026-04-01', 4, 10)).toBe(true);
    expect(inSeason('2026-11-01', 4, 10)).toBe(false);
    expect(inSeason('2026-12-15', 11, 2)).toBe(true);
    expect(inSeason('2027-02-28', 11, 2)).toBe(true);
    expect(inSeason('2027-03-01', 11, 2)).toBe(false);
  });

  it('Termine im Rhythmus, außerhalb der Saison ausgelassen', () => {
    const task = { nextDue: '2026-09-21', everyWeeks: 2, seasonFrom: 4, seasonTo: 10 };
    const result = taskOccurrences(task, '2026-11-30', null);
    expect(result.days).toEqual(['2026-09-21', '2026-10-05', '2026-10-19']);
    expect(result.nextDue).toBe('2026-12-14');
    // Vertragsende begrenzt
    expect(taskOccurrences(task, '2026-11-30', '2026-10-01').days).toEqual(['2026-09-21']);
    // nichts fällig
    expect(taskOccurrences(task, '2026-09-20', null)).toEqual({ days: [], nextDue: '2026-09-21' });
  });
});
