import { addMonths, Interval, MONTHS_PER_INTERVAL } from './recurring';

export type ContractState = 'active' | 'notice_soon' | 'cancelled' | 'expired' | 'open_ended';

export interface ContractTerms {
  termEnd: string | null; // JJJJ-MM-TT
  renewalMonths: number | null;
  noticeMonths: number;
  cancelledOn: string | null;
}

export interface TermsView {
  state: ContractState;
  // Ende der laufenden Laufzeit (bei Verlängerung fortgeschrieben)
  endsOn: string | null;
  // letzter Tag, an dem die Kündigung beim Anbieter sein muss
  noticeDeadline: string | null;
  daysToDeadline: number | null;
}

// ab so vielen Tagen vor der Frist gilt ein Vertrag als "bald kündigen"
export const NOTICE_WARNING_DAYS = 90;

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

// Laufzeit und Kündigungsfrist ausrechnen: eine abgelaufene Laufzeit mit
// automatischer Verlängerung wird fortgeschrieben; ist die Frist für die
// laufende Periode schon verstrichen, zählt die nächste Kündigungsmöglichkeit.
export function contractTerms(c: ContractTerms, today: string): TermsView {
  if (!c.termEnd) {
    // unbefristet: jederzeit mit der Frist kündbar
    if (c.cancelledOn) {
      const endsOn = addMonths(c.cancelledOn, c.noticeMonths);
      return {
        state: endsOn < today ? 'expired' : 'cancelled',
        endsOn,
        noticeDeadline: null,
        daysToDeadline: null,
      };
    }
    return { state: 'open_ended', endsOn: null, noticeDeadline: null, daysToDeadline: null };
  }
  let endsOn = c.termEnd;
  if (c.cancelledOn) {
    return {
      state: endsOn < today ? 'expired' : 'cancelled',
      endsOn,
      noticeDeadline: null,
      daysToDeadline: null,
    };
  }
  const renewal = c.renewalMonths && c.renewalMonths > 0 ? c.renewalMonths : null;
  if (!renewal) {
    if (endsOn < today) return { state: 'expired', endsOn, noticeDeadline: null, daysToDeadline: null };
  } else {
    // bis die laufende Periode heute oder später endet und die Frist noch erreichbar ist
    for (let i = 0; i < 1000 && addMonths(endsOn, -c.noticeMonths) < today; i++) {
      endsOn = addMonths(endsOn, renewal);
    }
  }
  const noticeDeadline = addMonths(endsOn, -c.noticeMonths);
  const daysToDeadline = days(today, noticeDeadline);
  return {
    state: daysToDeadline >= 0 && daysToDeadline <= NOTICE_WARNING_DAYS ? 'notice_soon' : 'active',
    endsOn,
    noticeDeadline: daysToDeadline >= 0 ? noticeDeadline : null,
    daysToDeadline: daysToDeadline >= 0 ? daysToDeadline : null,
  };
}

// Kosten pro Jahr aus Betrag und Rhythmus
export function yearlyAmount(amount: number | null, interval: Interval | null) {
  if (amount === null || !interval) return null;
  return Math.round(((amount * 12) / MONTHS_PER_INTERVAL[interval]) * 100) / 100;
}
