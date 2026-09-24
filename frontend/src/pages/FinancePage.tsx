import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { formatEuro } from '../format';
import { CategoriesTab } from './finance/CategoriesTab';
import { ForecastSection } from './finance/ForecastSection';
import { PayablesTab } from './finance/PayablesTab';
import { RecurringTab } from './finance/RecurringTab';
import { day, monthLabel } from './finance/shared';
import { TransactionsTab } from './finance/TransactionsTab';
import { YearTab } from './finance/YearTab';

interface Month {
  month: string; // JJJJ-MM
  invoiced: string;
  received: string;
  spent: string;
}

interface Overview {
  today: string;
  accounts: { iban: string; balance: string; date: string }[];
  totalBalance: string;
  transactionsUntil: string | null;
  receivables: { count: number; open: string; overdue: string; dueNext30Days: string };
  months: Month[];
}

// IBAN in Vierergruppen, gekürzt: DE89 3704 … 3000
const shortIban = (iban: string) => `${iban.slice(0, 4)} ${iban.slice(4, 8)} … ${iban.slice(-4)}`;

// Kategorie-Farben (validiert: Farbfehlsichtigkeit, Kontrast auf hellem Grund)
const SERIES = [
  { key: 'received' as const, label: 'Zahlungseingänge', color: '#2a78d6' },
  { key: 'spent' as const, label: 'Ausgaben', color: '#eb6834' },
];

function StatTile({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: string;
  note?: string;
  testId: string;
}) {
  return (
    <div className="job-card" style={{ flex: '1 1 200px', display: 'block' }} data-testid={testId}>
      <div className="list-item-meta">{label}</div>
      <div style={{ fontSize: '1.6rem', fontFamily: 'var(--font-display)', margin: '4px 0' }}>{value}</div>
      {note && <div className="list-item-meta">{note}</div>}
    </div>
  );
}

// Zahlungseingänge und Ausgaben je Monat als gruppierte Balken; Hover zeigt
// die Werte des Monats, darunter wahlweise als Tabelle.
function MonthChart({ months }: { months: Month[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  // tatsächliche Breite messen: 1 Einheit = 1 Pixel, Schrift bleibt lesbar
  const [width, setWidth] = useState(720);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, Math.min(720, Math.round(entry.contentRect.width)))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [asTable]);
  const height = 220;
  const pad = { top: 12, right: 8, bottom: 26, left: 60 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...months.flatMap((m) => [Number(m.received), Number(m.spent)]));
  // runde Achsenschritte: 1, 2 oder 5 × Zehnerpotenz, vier Linien
  const rawStep = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map((f) => f * magnitude).find((s) => s >= rawStep)!;
  const top = step * Math.ceil(max / step);
  const y = (value: number) => pad.top + plotH - (value / top) * plotH;
  const slot = plotW / months.length;
  const barW = Math.max(3, Math.min(18, (slot - 8) / 2));
  // schmale Bildschirme: nur jeden zweiten Monat beschriften
  const labelEvery = slot < 44 ? 2 : 1;

  return (
    <section style={{ marginTop: 24 }} data-testid="finance-chart">
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap' }}
      >
        <h3 style={{ marginBottom: 4 }}>Einnahmen und Ausgaben je Monat</h3>
        <button className="btn" onClick={() => setAsTable(!asTable)} data-testid="finance-chart-toggle">
          {asTable ? 'Als Diagramm' : 'Als Tabelle'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: '0.85rem', margin: '4px 0 8px' }} aria-hidden="true">
        {SERIES.map((s) => (
          <span
            key={s.key}
            style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-ink)' }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      {asTable ? (
        <table className="finance-table" data-testid="finance-month-table">
          <thead>
            <tr>
              <th>Monat</th>
              <th>Rechnungen (brutto)</th>
              <th>Zahlungseingänge</th>
              <th>Ausgaben</th>
              <th>Saldo</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month}>
                <td>{monthLabel(m.month)}</td>
                <td>{formatEuro(m.invoiced)}</td>
                <td>{formatEuro(m.received)}</td>
                <td>{formatEuro(m.spent)}</td>
                <td>{formatEuro(Number(m.received) - Number(m.spent))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div ref={box} style={{ position: 'relative', maxWidth: 720 }}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            role="img"
            aria-label="Zahlungseingänge und Ausgaben der letzten zwölf Monate; Werte auch als Tabelle"
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
                  {SERIES.map((s, j) => {
                    const value = Number(m[s.key]);
                    const h = Math.max(0, pad.top + plotH - y(value));
                    const x = x0 + j * (barW + 2); // 2px Abstand zwischen den Balken
                    const r = Math.min(4, h, barW / 2);
                    // oben abgerundet, unten gerade auf der Nulllinie
                    const path =
                      h <= 0
                        ? ''
                        : `M${x},${y(0)} V${y(value) + r} Q${x},${y(value)} ${x + r},${y(value)} H${x + barW - r} Q${x + barW},${y(value)} ${x + barW},${y(value) + r} V${y(0)} Z`;
                    return path ? (
                      <path
                        key={s.key}
                        d={path}
                        fill={s.color}
                        opacity={hover === null || hover === i ? 1 : 0.35}
                      />
                    ) : null;
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
                  {/* Trefferfläche größer als die Balken */}
                  <rect
                    x={pad.left + i * slot}
                    y={pad.top}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    data-testid="finance-chart-month"
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
                top: 8,
                // rechte Hälfte: links neben den Monat, sonst rechts daneben
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
              data-testid="finance-chart-tooltip"
            >
              <strong>{monthLabel(months[hover].month)}</strong>
              {SERIES.map((s) => (
                <div key={s.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                  {s.label}: {formatEuro(months[hover][s.key])}
                </div>
              ))}
              <div className="list-item-meta">Rechnungen: {formatEuro(months[hover].invoiced)}</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type Tab = 'overview' | 'transactions' | 'payables' | 'recurring' | 'year' | 'categories';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Übersicht' },
  { key: 'transactions', label: 'Kontobewegungen' },
  { key: 'payables', label: 'Eingangsrechnungen' },
  { key: 'recurring', label: 'Fixkosten' },
  { key: 'year', label: 'Jahresüberblick' },
  { key: 'categories', label: 'Kategorien' },
];

// Finanzbereich für Geschäftsführung und Buchhaltung: eine Übersicht aus
// Kontoauszügen und Rechnungen – die Buchführung bleibt bei DATEV.
export function FinancePage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get('tab'))?.key ?? 'overview';
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Overview>('/finance/overview')
      .then(setOverview)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Übersicht konnte nicht geladen werden.'),
      );
  }, []);

  const r = overview?.receivables;
  return (
    <div>
      <header className="my-day-header">
        <h2>Finanzen</h2>
      </header>
      <p className="list-item-meta">
        Übersicht aus Kontoauszügen und Rechnungen – keine Buchführung (die bleibt bei DATEV und dem
        Steuerberater). Kontoauszüge liest du im <Link to="/bankabgleich">Bankabgleich</Link> ein
        {overview?.transactionsUntil
          ? `; eingelesen bis ${day(overview.transactionsUntil)}.`
          : '; noch keiner eingelesen.'}
      </p>
      <div className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'active' : ''}
            onClick={() => setParams(t.key === 'overview' ? {} : { tab: t.key }, { replace: true })}
            data-testid={`finance-tab-${t.key}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          {error && <p className="field-error">{error}</p>}
          {overview === null && !error && <p>Lädt …</p>}
          {overview && r && (
            <>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                <StatTile
                  label="Kontostand"
                  value={overview.accounts.length ? formatEuro(overview.totalBalance) : '–'}
                  note={
                    overview.accounts.length
                      ? overview.accounts.map((a) => `${shortIban(a.iban)}: Stand ${day(a.date)}`).join(' · ')
                      : 'aus dem nächsten Kontoauszug'
                  }
                  testId="finance-balance"
                />
                <StatTile
                  label="Offene Forderungen"
                  value={formatEuro(r.open)}
                  note={`${r.count} Rechnung${r.count === 1 ? '' : 'en'}`}
                  testId="finance-receivables"
                />
                <StatTile
                  label="Davon überfällig"
                  value={formatEuro(r.overdue)}
                  note={
                    Number(r.overdue) > 0 ? '⚠ Mahnung prüfen – siehe Offene Posten' : 'nichts überfällig'
                  }
                  testId="finance-overdue"
                />
                <StatTile
                  label="Fällig in 30 Tagen"
                  value={formatEuro(r.dueNext30Days)}
                  note="erwartete Zahlungseingänge"
                  testId="finance-due-soon"
                />
              </div>
              <ForecastSection />
              <MonthChart months={overview.months} />
            </>
          )}
        </>
      )}
      {tab === 'transactions' && <TransactionsTab />}
      {tab === 'payables' && <PayablesTab />}
      {tab === 'recurring' && <RecurringTab />}
      {tab === 'year' && <YearTab />}
      {tab === 'categories' && <CategoriesTab />}
    </div>
  );
}
