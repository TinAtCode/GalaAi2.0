import { useState } from 'react';
import { formatEuro } from '../format';

export interface Slice {
  key: string;
  label: string;
  value: number;
}

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const MAX_SLICES = 5;

// Größte Posten behalten, den Rest zu "Sonstige" zusammenfassen: höchstens
// fünf farbige Segmente plus ein graues (mehr Stücke sind nicht lesbar)
export function foldSlices(slices: Slice[], max = MAX_SLICES): (Slice & { color: string })[] {
  const positive = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const result = positive.slice(0, max).map((s, i) => ({ ...s, color: COLORS[i] }));
  const rest = positive.slice(max);
  if (rest.length)
    result.push({
      key: 'other',
      label: rest.length === 1 ? rest[0].label : `Sonstige (${rest.length})`,
      value: rest.reduce((sum, s) => sum + s.value, 0),
      color: 'var(--chart-other)',
    });
  return result;
}

const polar = (cx: number, cy: number, r: number, angle: number) => [
  cx + r * Math.cos(angle - Math.PI / 2),
  cy + r * Math.sin(angle - Math.PI / 2),
];

function arc(cx: number, cy: number, outer: number, inner: number, start: number, end: number) {
  const large = end - start > Math.PI ? 1 : 0;
  const [x1, y1] = polar(cx, cy, outer, start);
  const [x2, y2] = polar(cx, cy, outer, end);
  const [x3, y3] = polar(cx, cy, inner, end);
  const [x4, y4] = polar(cx, cy, inner, start);
  return `M${x1} ${y1}A${outer} ${outer} 0 ${large} 1 ${x2} ${y2}L${x3} ${y3}A${inner} ${inner} 0 ${large} 0 ${x4} ${y4}Z`;
}

// Ringdiagramm für Anteile auf einen Blick: Legende mit Betrag und Anteil
// (Zuordnung nie nur über die Farbe), Tooltip beim Zeigen, Summe in der Mitte
export function DonutChart({
  slices,
  title,
  testId,
  format = formatEuro,
}: {
  slices: Slice[];
  title: string;
  testId?: string;
  format?: (value: number) => string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const shown = foldSlices(slices);
  const total = shown.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;
  const size = 180;
  const c = size / 2;
  // Start- und Endwinkel je Segment vorab berechnen
  const angles = shown.reduce<[number, number][]>((list, s) => {
    const start = list.length ? list[list.length - 1][1] : 0;
    return [...list, [start, start + (s.value / total) * Math.PI * 2]];
  }, []);
  const pct = (v: number) => `${((v / total) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;
  const current = shown.find((s) => s.key === active);

  return (
    <figure
      style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', margin: '8px 0 16px' }}
      data-testid={testId}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${title}: ${shown.map((s) => `${s.label} ${pct(s.value)}`).join(', ')}`}
        style={{ flex: 'none' }}
      >
        {shown.map((s, index) => {
          const [start, end] = angles[index];
          // ein einziges Segment als voller Ring (ein Bogen über 360° wird nicht gezeichnet)
          const d =
            shown.length === 1
              ? arc(c, c, c - 4, c - 34, 0, Math.PI * 2 - 0.0001)
              : arc(c, c, active === s.key ? c - 1 : c - 4, c - 34, start, end);
          return (
            <path
              key={s.key}
              d={d}
              fill={s.color}
              stroke="var(--color-surface)"
              strokeWidth={2}
              tabIndex={0}
              aria-label={`${s.label}: ${format(s.value)} (${pct(s.value)})`}
              onMouseEnter={() => setActive(s.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(s.key)}
              onBlur={() => setActive(null)}
              style={{ cursor: 'default', outline: 'none' }}
            />
          );
        })}
        <text x={c} y={c - 4} textAnchor="middle" fontSize="12" fill="var(--color-ink-muted)">
          {current ? (current.label.length > 16 ? `${current.label.slice(0, 15)}…` : current.label) : 'Summe'}
        </text>
        <text x={c} y={c + 14} textAnchor="middle" fontSize="14" fontWeight={600} fill="var(--color-ink)">
          {format(current ? current.value : total)}
        </text>
      </svg>
      <figcaption style={{ flex: '1 1 200px', minWidth: 0, maxWidth: 440 }}>
        <div className="list-item-meta" style={{ marginBottom: 6 }}>
          {title}
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {shown.map((s) => (
            <li
              key={s.key}
              onMouseEnter={() => setActive(s.key)}
              onMouseLeave={() => setActive(null)}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: '2px 0',
                fontWeight: active === s.key ? 600 : 400,
              }}
              data-testid="donut-legend"
            >
              <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flex: 'none' }} />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.label}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{format(s.value)}</span>
              <span className="list-item-meta" style={{ width: 52, textAlign: 'right' }}>
                {pct(s.value)}
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
