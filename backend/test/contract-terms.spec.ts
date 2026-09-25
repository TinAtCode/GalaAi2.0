import { contractTerms, yearlyAmount } from '../src/finance/contract-terms';

const base = { termEnd: null, renewalMonths: null, noticeMonths: 3, cancelledOn: null };

describe('Vertragsfristen', () => {
  it('Frist = Laufzeitende minus Kündigungsfrist, bald fällig innerhalb von 90 Tagen', () => {
    expect(contractTerms({ ...base, termEnd: '2026-12-31', renewalMonths: 12 }, '2026-09-25')).toEqual({
      state: 'notice_soon',
      endsOn: '2026-12-31',
      noticeDeadline: '2026-09-30',
      daysToDeadline: 5,
    });
    expect(contractTerms({ ...base, termEnd: '2027-12-31', renewalMonths: 12 }, '2026-09-25').state).toBe(
      'active',
    );
  });

  it('verpasste Frist: die Laufzeit verlängert sich, es zählt die nächste Möglichkeit', () => {
    expect(contractTerms({ ...base, termEnd: '2026-12-31', renewalMonths: 12 }, '2026-10-05')).toMatchObject({
      endsOn: '2027-12-31',
      noticeDeadline: '2027-09-30',
      state: 'active',
    });
    // mehrere Jahre abgelaufen, jährliche Verlängerung
    expect(
      contractTerms({ ...base, termEnd: '2020-06-30', renewalMonths: 12, noticeMonths: 1 }, '2026-09-25'),
    ).toMatchObject({
      endsOn: '2027-06-30',
      noticeDeadline: '2027-05-30',
    });
  });

  it('ohne Verlängerung läuft der Vertrag aus; gekündigte enden zum Laufzeitende', () => {
    expect(contractTerms({ ...base, termEnd: '2026-01-31' }, '2026-09-25').state).toBe('expired');
    expect(
      contractTerms(
        { ...base, termEnd: '2026-12-31', renewalMonths: 12, cancelledOn: '2026-08-01' },
        '2026-09-25',
      ),
    ).toEqual({ state: 'cancelled', endsOn: '2026-12-31', noticeDeadline: null, daysToDeadline: null });
  });

  it('unbefristet: jederzeit kündbar, Ende = Kündigung plus Frist', () => {
    expect(contractTerms({ ...base }, '2026-09-25').state).toBe('open_ended');
    expect(contractTerms({ ...base, cancelledOn: '2026-09-01' }, '2026-09-25')).toMatchObject({
      state: 'cancelled',
      endsOn: '2026-12-01',
    });
  });

  it('rechnet Beiträge aufs Jahr', () => {
    expect(yearlyAmount(49.9, 'monthly')).toBe(598.8);
    expect(yearlyAmount(300, 'quarterly')).toBe(1200);
    expect(yearlyAmount(null, 'yearly')).toBeNull();
  });
});
