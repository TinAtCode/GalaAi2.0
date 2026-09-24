import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { formatEuro } from '../../format';
import { day } from './shared';

interface Week {
  from: string;
  to: string;
  income: string;
  expenses: string;
  balance: string;
  items: { kind: 'receivable' | 'payable' | 'recurring'; name: string; date: string; amount: string }[];
}

interface Forecast {
  today: string;
  startBalance: string;
  balanceDate: string | null;
  weeks: Week[];
  lowest: { from: string; balance: string };
  payables: {
    count: number;
    total: string;
    overdue: string;
    discountCount: number;
    discountSaving: string;
    nextDiscount: string | null;
  };
}

const KIND: Record<Week['items'][number]['kind'], string> = {
  receivable: 'Eingang',
  payable: 'Eingangsrechnung',
  recurring: 'Fixkosten',
};
const short = (iso: string) => day(iso).slice(0, 6);

// Liquiditätsvorschau: Kontostand der nächsten 13 Wochen aus offenen
// Rechnungen (Eingänge), Eingangsrechnungen und Fixkosten (Ausgaben)
export function ForecastSection() {
  const [data, setData] = useState<Forecast | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Forecast>('/finance/forecast')
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Vorschau konnte nicht geladen werden.'),
      );
  }, []);

  if (error) return <p className="field-error">{error}</p>;
  if (!data) return null;
  const last = data.weeks[data.weeks.length - 1];
  const tiles = [
    {
      id: 'end',
      label: 'Stand in 13 Wochen',
      value: formatEuro(last.balance),
      note: data.balanceDate ? `ab Kontostand vom ${day(data.balanceDate)}` : 'ohne Kontoauszug ab 0 €',
    },
    {
      id: 'lowest',
      label: 'Tiefster Stand',
      value: formatEuro(data.lowest.balance),
      note: `in der Woche ab ${day(data.lowest.from)}`,
      warn: Number(data.lowest.balance) < 0,
    },
    {
      id: 'payables',
      label: 'Offene Eingangsrechnungen',
      value: formatEuro(data.payables.total),
      note:
        Number(data.payables.overdue) > 0
          ? `⚠ ${formatEuro(data.payables.overdue)} überfällig`
          : `${data.payables.count} Rechnung${data.payables.count === 1 ? '' : 'en'}`,
      noteWarn: Number(data.payables.overdue) > 0,
    },
    {
      id: 'discount',
      label: 'Skonto möglich',
      value: formatEuro(data.payables.discountSaving),
      note: data.payables.nextDiscount
        ? `${data.payables.discountCount}× · nächste Frist ${day(data.payables.nextDiscount)}`
        : 'keine laufende Skontofrist',
    },
  ];

  return (
    <section style={{ marginTop: 28 }} data-testid="finance-forecast">
      <h3 style={{ marginBottom: 4 }}>Liquiditätsvorschau</h3>
      <p className="list-item-meta" style={{ marginTop: 0 }}>
        Erwartete Zahlungseingänge aus offenen Rechnungen, geplante Ausgaben aus Eingangsrechnungen (mit
        Skonto, solange die Frist läuft) und Fixkosten.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {tiles.map((t) => (
          <div
            key={t.id}
            className="job-card"
            style={{ flex: '1 1 200px', display: 'block' }}
            data-testid={`forecast-${t.id}`}
          >
            <div className="list-item-meta">{t.label}</div>
            <div
              style={{
                fontSize: '1.4rem',
                fontFamily: 'var(--font-display)',
                margin: '4px 0',
                color: t.warn ? 'var(--color-danger)' : undefined,
              }}
            >
              {t.value}
            </div>
            <div
              className="list-item-meta"
              style={'noteWarn' in t && t.noteWarn ? { color: 'var(--color-danger)' } : undefined}
            >
              {t.note}
            </div>
          </div>
        ))}
      </div>
      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table className="finance-table" data-testid="forecast-table">
          <thead>
            <tr>
              <th>Woche</th>
              <th>Eingänge</th>
              <th>Ausgaben</th>
              <th>Stand</th>
            </tr>
          </thead>
          <tbody>
            {data.weeks.map((w) => [
              <tr key={w.from} data-testid="forecast-week">
                <td style={{ whiteSpace: 'nowrap' }}>
                  {w.items.length ? (
                    <button
                      type="button"
                      onClick={() => setOpen(open === w.from ? null : w.from)}
                      aria-expanded={open === w.from}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        color: 'inherit',
                        font: 'inherit',
                      }}
                    >
                      {open === w.from ? '▾' : '▸'} {short(w.from)}–{short(w.to)}
                    </button>
                  ) : (
                    `${short(w.from)}–${short(w.to)}`
                  )}
                </td>
                <td>{Number(w.income) ? formatEuro(w.income) : '–'}</td>
                <td>{Number(w.expenses) ? formatEuro(w.expenses) : '–'}</td>
                <td
                  style={
                    Number(w.balance) < 0 ? { color: 'var(--color-danger)', fontWeight: 600 } : undefined
                  }
                >
                  {formatEuro(w.balance)}
                </td>
              </tr>,
              open === w.from && (
                <tr key={`${w.from}-items`}>
                  <td colSpan={4} style={{ textAlign: 'left' }} data-testid="forecast-items">
                    {w.items.map((i, n) => (
                      <div key={n}>
                        {day(i.date)} · {KIND[i.kind]}: {i.name} {i.kind === 'receivable' ? '+' : '−'}
                        {formatEuro(i.amount)}
                      </div>
                    ))}
                  </td>
                </tr>
              ),
            ])}
          </tbody>
        </table>
      </div>
    </section>
  );
}
