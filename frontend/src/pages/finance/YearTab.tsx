import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { formatEuro } from '../../format';
import { day, monthLabel } from './shared';

interface YearMonth {
  month: string;
  income: string;
  expenses: Record<string, string>; // Kategorie-ID oder "none"
  spent: string;
  planned: {
    kind: 'recurring' | 'payable';
    id: string;
    name: string;
    amount: string;
    due: string;
    categoryId: string | null;
  }[];
  plannedTotal: string;
  expectedIncome: string;
  future: boolean;
}

interface YearOverview {
  year: number;
  today: string;
  categories: { id: string; name: string }[];
  months: YearMonth[];
  fixedCostsPerMonth: string;
}

// Ist in voller Farbe, Geplantes/Erwartetes als hellere Stufe derselben Farbe
const SERIES = {
  income: { label: 'Eingänge', color: '#2a78d6', light: '#a9c9ef' },
  spent: { label: 'Ausgaben', color: '#eb6834', light: '#f6c1a4' },
};

function YearChart({ months }: { months: YearMonth[] }) {
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, Math.min(720, Math.round(entry.contentRect.width)))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = 220;
  const pad = { top: 12, right: 8, bottom: 26, left: 60 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const bars = months.map((m) => ({
    income: [Number(m.income), Number(m.expectedIncome)],
    spent: [Number(m.spent), Number(m.plannedTotal)],
  }));
  const max = Math.max(1, ...bars.flatMap((b) => [b.income[0] + b.income[1], b.spent[0] + b.spent[1]]));
  const rawStep = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map((f) => f * magnitude).find((s) => s >= rawStep)!;
  const top = step * Math.ceil(max / step);
  const y = (value: number) => pad.top + plotH - (value / top) * plotH;
  const slot = plotW / months.length;
  const barW = Math.max(3, Math.min(18, (slot - 8) / 2));
  const labelEvery = slot < 44 ? 2 : 1;

  return (
    <div ref={box} style={{ position: 'relative', maxWidth: 720 }} data-testid="year-chart">
      <div
        style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: '0.85rem', margin: '4px 0 8px' }}
        aria-hidden="true"
      >
        {(['income', 'spent'] as const)
          .flatMap((key) => [
            { color: SERIES[key].color, label: SERIES[key].label },
            {
              color: SERIES[key].light,
              label:
                key === 'income' ? 'erwartet (offene Rechnungen)' : 'geplant (Fixkosten, Eingangsrechnungen)',
            },
          ])
          .map((s) => (
            <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />
              {s.label}
            </span>
          ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label="Eingänge und Ausgaben je Monat, Ist und geplant; Werte auch in der Tabelle darunter"
        onMouseLeave={() => setHover(null)}
      >
        {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((value) => (
          <g key={value}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--color-border)"
            />
            <text
              x={pad.left - 8}
              y={y(value) + 4}
              textAnchor="end"
              fontSize="12"
              fill="var(--color-ink-muted)"
            >
              {value.toLocaleString('de-DE')} €
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const x0 = pad.left + i * slot + (slot - 2 * barW - 2) / 2;
          return (
            <g key={m.month}>
              {(['income', 'spent'] as const).map((key, j) => {
                const [actual, planned] = bars[i][key];
                const x = x0 + j * (barW + 2);
                // gestapelt: Ist unten, darüber hell das Geplante; 1px Fuge
                const hA = Math.max(0, y(0) - y(actual));
                const hP = Math.max(0, y(0) - y(actual + planned) - hA - (actual > 0 && planned > 0 ? 1 : 0));
                return (
                  <g key={key} opacity={hover === null || hover === i ? 1 : 0.35}>
                    {hA > 0 && <rect x={x} y={y(0) - hA} width={barW} height={hA} fill={SERIES[key].color} />}
                    {hP > 0 && (
                      <rect x={x} y={y(actual + planned)} width={barW} height={hP} fill={SERIES[key].light} />
                    )}
                  </g>
                );
              })}
              {(months.length - 1 - i) % labelEvery === 0 && (
                <text
                  x={pad.left + i * slot + slot / 2}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize="12"
                  fill="var(--color-ink-muted)"
                >
                  {monthLabel(m.month)}
                </text>
              )}
              <rect
                x={pad.left + i * slot}
                y={pad.top}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="job-card"
          role="status"
          style={{
            position: 'absolute',
            top: 36,
            ...(hover >= months.length / 2
              ? { right: width - (pad.left + hover * slot) + 4 }
              : { left: pad.left + (hover + 1) * slot + 4 }),
            whiteSpace: 'nowrap',
            display: 'block',
            padding: '8px 10px',
            fontSize: '0.85rem',
            pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          }}
        >
          <strong>{monthLabel(months[hover].month)}</strong>
          <div>Eingänge: {formatEuro(months[hover].income)}</div>
          {Number(months[hover].expectedIncome) > 0 && (
            <div>erwartet: {formatEuro(months[hover].expectedIncome)}</div>
          )}
          <div>Ausgaben: {formatEuro(months[hover].spent)}</div>
          {Number(months[hover].plannedTotal) > 0 && (
            <div>geplant: {formatEuro(months[hover].plannedTotal)}</div>
          )}
        </div>
      )}
    </div>
  );
}

// Jahresüberblick: was je Monat ein- und ausging (Kontoauszug), was an
// Fixkosten noch ansteht und welche Zahlungseingänge erwartet werden
export function YearTab() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [data, setData] = useState<YearOverview | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const requestId = ++latest.current;
    api
      .get<YearOverview>(`/finance/year?year=${year}`)
      .then((result) => requestId === latest.current && setData(result))
      .catch((err) => {
        if (requestId === latest.current)
          setError(err instanceof ApiError ? err.message : 'Jahresüberblick konnte nicht geladen werden.');
      });
  }, [year]);

  const changeYear = (next: number) => {
    setData(null);
    setError(null);
    setOpen(null);
    setYear(next);
  };

  const name = (id: string) =>
    id === 'none'
      ? 'ohne Kategorie'
      : (data?.categories.find((c) => c.id === id)?.name ?? 'gelöschte Kategorie');
  const sum = (values: (string | number)[]) => values.reduce<number>((a, v) => a + Number(v), 0);
  const months = data?.months ?? [];
  const totals = {
    income: sum(months.map((m) => m.income)),
    spent: sum(months.map((m) => m.spent)),
    planned: sum(months.map((m) => m.plannedTotal)),
    expected: sum(months.map((m) => m.expectedIncome)),
  };
  // Summe je Kategorie über das Jahr: Ist plus noch geplante Fixkosten
  const byCategory = new Map<string, { spent: number; planned: number }>();
  for (const m of months) {
    for (const [id, value] of Object.entries(m.expenses)) {
      const entry = byCategory.get(id) ?? { spent: 0, planned: 0 };
      entry.spent += Number(value);
      byCategory.set(id, entry);
    }
    for (const p of m.planned) {
      const id = p.categoryId ?? 'none';
      const entry = byCategory.get(id) ?? { spent: 0, planned: 0 };
      entry.planned += Number(p.amount);
      byCategory.set(id, entry);
    }
  }
  const categoryRows = [...byCategory.entries()].sort(
    (a, b) => b[1].spent + b[1].planned - (a[1].spent + a[1].planned),
  );

  return (
    <section>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <button
          className="btn"
          onClick={() => changeYear(year - 1)}
          aria-label="Vorjahr"
          data-testid="year-prev"
        >
          ‹
        </button>
        <h3 style={{ margin: 0 }} data-testid="year-title">
          {year}
        </h3>
        <button
          className="btn"
          onClick={() => changeYear(year + 1)}
          aria-label="Folgejahr"
          data-testid="year-next"
        >
          ›
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
      {data === null && !error && <p>Lädt …</p>}
      {data && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {[
              {
                label: 'Eingänge',
                value: totals.income,
                note: `erwartet noch ${formatEuro(totals.expected)}`,
                id: 'income',
              },
              {
                label: 'Ausgaben',
                value: totals.spent,
                note: `geplant noch ${formatEuro(totals.planned)}`,
                id: 'spent',
              },
              {
                label: 'Fixkosten je Monat',
                value: Number(data.fixedCostsPerMonth),
                note: 'Durchschnitt aller Fixkosten',
                id: 'fixed',
              },
              {
                label: 'Ergebnis mit Planung',
                value: totals.income + totals.expected - totals.spent - totals.planned,
                note: 'Eingänge + erwartet − Ausgaben − geplant',
                id: 'result',
              },
            ].map((tile) => (
              <div
                key={tile.id}
                className="job-card"
                style={{ flex: '1 1 200px', display: 'block' }}
                data-testid={`year-${tile.id}`}
              >
                <div className="list-item-meta">{tile.label}</div>
                <div style={{ fontSize: '1.4rem', fontFamily: 'var(--font-display)', margin: '4px 0' }}>
                  {formatEuro(tile.value)}
                </div>
                <div className="list-item-meta">{tile.note}</div>
              </div>
            ))}
          </div>

          <section style={{ marginTop: 20 }}>
            <YearChart months={months} />
          </section>

          <div style={{ overflowX: 'auto', marginTop: 16 }}>
            <table className="finance-table" data-testid="year-table">
              <thead>
                <tr>
                  <th>Monat</th>
                  <th>Eingänge</th>
                  <th>Ausgaben</th>
                  <th>geplant</th>
                  <th>erwartet</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const details = Object.keys(m.expenses).length > 0 || m.planned.length > 0;
                  return [
                    <tr key={m.month} data-testid="year-month">
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {details ? (
                          <button
                            type="button"
                            onClick={() => setOpen(open === m.month ? null : m.month)}
                            aria-expanded={open === m.month}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              color: 'inherit',
                              font: 'inherit',
                            }}
                          >
                            {open === m.month ? '▾' : '▸'} {monthLabel(m.month)}
                          </button>
                        ) : (
                          monthLabel(m.month)
                        )}
                      </td>
                      <td>{m.future && !Number(m.income) ? '–' : formatEuro(m.income)}</td>
                      <td>{m.future && !Number(m.spent) ? '–' : formatEuro(m.spent)}</td>
                      <td>{Number(m.plannedTotal) ? formatEuro(m.plannedTotal) : '–'}</td>
                      <td>{Number(m.expectedIncome) ? formatEuro(m.expectedIncome) : '–'}</td>
                    </tr>,
                    open === m.month && (
                      <tr key={`${m.month}-details`}>
                        <td colSpan={5} style={{ textAlign: 'left' }} data-testid="year-month-details">
                          {Object.entries(m.expenses).map(([id, value]) => (
                            <div key={id}>
                              {name(id)}: {formatEuro(value)}
                            </div>
                          ))}
                          {m.planned.map((p) => (
                            <div key={`${p.id}-${p.due}`} className="list-item-meta">
                              {p.kind === 'payable' ? 'Eingangsrechnung' : 'geplant'} {day(p.due)}: {p.name}{' '}
                              {formatEuro(p.amount)}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th>Summe</th>
                  <th>{formatEuro(totals.income)}</th>
                  <th>{formatEuro(totals.spent)}</th>
                  <th>{formatEuro(totals.planned)}</th>
                  <th>{formatEuro(totals.expected)}</th>
                </tr>
              </tfoot>
            </table>
          </div>

          <h3 style={{ margin: '24px 0 4px' }}>Ausgaben nach Kategorie</h3>
          {categoryRows.length === 0 ? (
            <p className="list-item-meta">Keine Ausgaben in {year}.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="finance-table" data-testid="year-categories">
                <thead>
                  <tr>
                    <th>Kategorie</th>
                    <th>bisher</th>
                    <th>geplant</th>
                    <th>Jahr</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryRows.map(([id, v]) => (
                    <tr key={id}>
                      <td>{name(id)}</td>
                      <td>{formatEuro(v.spent)}</td>
                      <td>{v.planned ? formatEuro(v.planned) : '–'}</td>
                      <td>{formatEuro(v.spent + v.planned)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
