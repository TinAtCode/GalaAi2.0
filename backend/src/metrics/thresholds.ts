import { LATENCY_BUCKETS } from './metrics';

// Vorschläge für die Alarmschwellen (ops/prometheus/alerts.yml) aus dem
// Verlauf der Betriebswerte (MetricSample). Rechnet wie die Alarmregeln:
// Fehlerquote und 95. Perzentil der Antwortzeit über 5 Minuten und alle
// Server, die übrigen Werte je Server; ein Alarm feuert, wenn der Wert
// `forMinutes` Minuten am Stück über der Schwelle liegt.

export interface Sample {
  at: Date;
  instance: string;
  requests: number;
  serverErrors: number;
  latencyBuckets: number[];
  eventLoopP99Seconds: number;
  rssBytes: number;
  ocrWaiting: number;
  mailFailures: number;
}

type Unit = 'ratio' | 'seconds' | 'count' | 'bytes';

interface RuleDef {
  alert: string;
  label: string;
  unit: Unit;
  // Schwelle in ops/prometheus/alerts.yml (ein Unit-Test prüft den Abgleich)
  current: number;
  forMinutes: number;
  // Vorschlag = Wert, den 99,9 % der Minuten nicht überschreiten, mal factor; nie unter floor
  factor: number;
  floor: number;
  series: (samples: Sample[]) => Point[];
}

interface Point {
  minute: number;
  key: string;
  value: number;
}

export interface RuleReport {
  alert: string;
  label: string;
  unit: Unit;
  forMinutes: number;
  current: number;
  suggested: number | null;
  minutes: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  p999: number | null;
  max: number | null;
  // wie oft der Alarm im Zeitraum ausgelöst hätte
  firedCurrent: number;
  firedSuggested: number;
}

export interface ThresholdReport {
  from: string | null;
  to: string | null;
  days: number;
  samples: number;
  // Server-Prozesse (jeder Neustart zählt als neuer)
  instances: number;
  enoughData: boolean;
  rules: RuleReport[];
  mailFailures: { total: number; days: number };
  // Lücken von mehr als 2 Minuten ohne Messpunkt (Neustart, Absturz, Ausfall)
  gaps: number;
}

export const MIN_DAYS = 14;
// ohne genug Anfragen sagt eine Quote oder ein Perzentil nichts
const MIN_REQUESTS = 20;
const WINDOW_MINUTES = 5;

const minuteOf = (at: Date) => Math.floor(at.getTime() / 60_000);

// Anfragen aller Server je Minute zusammenfassen, dann über 5 Minuten rollierend
function rolling(samples: Sample[]) {
  const perMinute = new Map<number, { requests: number; errors: number; buckets: number[] }>();
  for (const s of samples) {
    const minute = minuteOf(s.at);
    const entry = perMinute.get(minute) ?? {
      requests: 0,
      errors: 0,
      buckets: new Array<number>(LATENCY_BUCKETS.length + 1).fill(0),
    };
    entry.requests += s.requests;
    entry.errors += s.serverErrors;
    s.latencyBuckets.forEach((n, i) => (entry.buckets[i] = (entry.buckets[i] ?? 0) + n));
    perMinute.set(minute, entry);
  }
  return [...perMinute.keys()].map((minute) => {
    const window = { requests: 0, errors: 0, buckets: new Array<number>(LATENCY_BUCKETS.length + 1).fill(0) };
    for (let m = minute - WINDOW_MINUTES + 1; m <= minute; m++) {
      const entry = perMinute.get(m);
      if (!entry) continue;
      window.requests += entry.requests;
      window.errors += entry.errors;
      entry.buckets.forEach((n, i) => (window.buckets[i] += n));
    }
    return { minute, ...window };
  });
}

// wie histogram_quantile in Prometheus: linear innerhalb des Buckets; liegt
// das Quantil im letzten (+Inf), gilt die höchste endliche Grenze
export function histogramQuantile(q: number, buckets: number[]) {
  const total = buckets.reduce((sum, n) => sum + n, 0);
  if (!total) return null;
  const rank = q * total;
  let seen = 0;
  for (let i = 0; i < buckets.length; i++) {
    if (seen + buckets[i] >= rank && buckets[i] > 0) {
      if (i >= LATENCY_BUCKETS.length) return LATENCY_BUCKETS[LATENCY_BUCKETS.length - 1];
      const lower = i === 0 ? 0 : LATENCY_BUCKETS[i - 1];
      return lower + (LATENCY_BUCKETS[i] - lower) * ((rank - seen) / buckets[i]);
    }
    seen += buckets[i];
  }
  return LATENCY_BUCKETS[LATENCY_BUCKETS.length - 1];
}

const perInstance = (pick: (s: Sample) => number) => (samples: Sample[]) =>
  samples.map((s) => ({ minute: minuteOf(s.at), key: s.instance, value: pick(s) }));

export const RULES: RuleDef[] = [
  {
    alert: 'VieleServerfehler',
    label: 'Anteil Serverfehler (5 Minuten)',
    unit: 'ratio',
    current: 0.05,
    forMinutes: 10,
    factor: 2,
    floor: 0.01,
    series: (samples) =>
      rolling(samples)
        .filter((w) => w.requests >= MIN_REQUESTS)
        .map((w) => ({ minute: w.minute, key: 'alle', value: w.errors / w.requests })),
  },
  {
    alert: 'LangsameAntworten',
    label: '95. Perzentil der Antwortzeit (5 Minuten)',
    unit: 'seconds',
    current: 2,
    forMinutes: 10,
    factor: 1.5,
    floor: 0.5,
    series: (samples) =>
      rolling(samples)
        .filter((w) => w.requests >= MIN_REQUESTS)
        .map((w) => ({ minute: w.minute, key: 'alle', value: histogramQuantile(0.95, w.buckets) ?? 0 })),
  },
  {
    alert: 'OcrStau',
    label: 'Wartende Texterkennungen',
    unit: 'count',
    current: 10,
    forMinutes: 15,
    factor: 1.5,
    floor: 3,
    series: perInstance((s) => s.ocrWaiting),
  },
  {
    alert: 'EventLoopBlockiert',
    label: 'Event-Loop-Verzögerung (99. Perzentil)',
    unit: 'seconds',
    current: 0.5,
    forMinutes: 5,
    factor: 2,
    floor: 0.1,
    series: perInstance((s) => s.eventLoopP99Seconds),
  },
  {
    alert: 'HoherSpeicherverbrauch',
    label: 'Arbeitsspeicher (RSS)',
    unit: 'bytes',
    current: 1.5e9,
    forMinutes: 15,
    factor: 1.3,
    floor: 256e6,
    series: perInstance((s) => s.rssBytes),
  },
];

// Wert, den der Anteil q der sortierten Werte nicht überschreitet
function quantile(sorted: number[], q: number) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}

// auf eine runde Zahl aufrunden: 1, 1,5, 2, 2,5, 3, 4, 5, 6, 8 × 10^n
export function niceUp(value: number) {
  if (value <= 0) return 0;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s * power >= value * (1 - 1e-9))!;
  return Number((step * power).toPrecision(6));
}

// Wie oft wäre der Alarm ausgelöst: Folgen von mindestens forMinutes Minuten
// am Stück über der Schwelle (je Server bzw. über alle)
export function countFirings(points: Point[], threshold: number, forMinutes: number) {
  const byKey = new Map<string, Point[]>();
  for (const p of points) {
    const list = byKey.get(p.key);
    if (list) list.push(p);
    else byKey.set(p.key, [p]);
  }
  let firings = 0;
  for (const list of byKey.values()) {
    list.sort((a, b) => a.minute - b.minute);
    let run = 0;
    let last = Number.NEGATIVE_INFINITY;
    for (const p of list) {
      run = p.value > threshold ? (p.minute === last + 1 ? run + 1 : 1) : 0;
      last = p.minute;
      if (run === forMinutes) firings++;
    }
  }
  return firings;
}

export function thresholdReport(samples: Sample[]): ThresholdReport {
  const sorted = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  const from = sorted[0]?.at ?? null;
  const to = sorted[sorted.length - 1]?.at ?? null;
  const days = from && to ? (to.getTime() - from.getTime()) / 86_400_000 : 0;

  const rules = RULES.map((rule): RuleReport => {
    const points = rule.series(sorted);
    const values = points.map((p) => p.value).sort((a, b) => a - b);
    const p999 = quantile(values, 0.999);
    const suggested = p999 === null ? null : niceUp(Math.max(rule.floor, p999 * rule.factor));
    return {
      alert: rule.alert,
      label: rule.label,
      unit: rule.unit,
      forMinutes: rule.forMinutes,
      current: rule.current,
      suggested,
      minutes: values.length,
      p50: quantile(values, 0.5),
      p95: quantile(values, 0.95),
      p99: quantile(values, 0.99),
      p999,
      max: values.length ? values[values.length - 1] : null,
      firedCurrent: countFirings(points, rule.current, rule.forMinutes),
      firedSuggested: suggested === null ? 0 : countFirings(points, suggested, rule.forMinutes),
    };
  });

  const failureDays = new Set(
    sorted.filter((s) => s.mailFailures > 0).map((s) => s.at.toISOString().slice(0, 10)),
  );
  // Lücken im gesamten Verlauf: Minuten ohne Messpunkt irgendeines Servers
  // (eine Kennung gilt nur bis zum Neustart, daher nicht je Server)
  let gaps = 0;
  let lastMinute: number | undefined;
  for (const s of sorted) {
    const minute = minuteOf(s.at);
    if (lastMinute !== undefined && minute - lastMinute > 2) gaps++;
    lastMinute = minute;
  }
  const instances = new Set(sorted.map((s) => s.instance)).size;

  return {
    from: from?.toISOString() ?? null,
    to: to?.toISOString() ?? null,
    days: Math.round(days * 10) / 10,
    samples: sorted.length,
    instances,
    enoughData: days >= MIN_DAYS,
    rules,
    mailFailures: { total: sorted.reduce((sum, s) => sum + s.mailFailures, 0), days: failureDays.size },
    gaps,
  };
}

const formatValue = (unit: Unit, value: number | null) => {
  if (value === null) return '–';
  const de = (n: number, digits: number) =>
    n.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  switch (unit) {
    case 'ratio':
      return `${de(value * 100, 2)} %`;
    case 'seconds':
      return value < 1 ? `${de(value * 1000, 0)} ms` : `${de(value, 2)} s`;
    case 'bytes':
      return `${de(value / 1e6, 0)} MB`;
    default:
      return de(value, 1);
  }
};

// Bericht als Text für die Konsole
export function formatReport(report: ThresholdReport) {
  const lines: string[] = [];
  lines.push('Alarmschwellen – Auswertung des Verlaufs');
  if (!report.samples) {
    lines.push('', 'Noch keine Messpunkte. Der Verlauf wird jede Minute gespeichert (METRICS_HISTORY).');
    return lines.join('\n');
  }
  lines.push(
    `Zeitraum: ${report.from} bis ${report.to} (${report.days.toLocaleString('de-DE')} Tage, ${report.samples} Messpunkte, ${report.instances} Server-Prozesse)`,
  );
  if (!report.enoughData) {
    lines.push(`Hinweis: Weniger als ${MIN_DAYS} Tage Daten – die Vorschläge sind vorläufig.`);
  }
  for (const rule of report.rules) {
    const f = (v: number | null) => formatValue(rule.unit, v);
    lines.push('', `${rule.alert} – ${rule.label}, ${rule.forMinutes} Minuten am Stück`);
    if (!rule.minutes) {
      lines.push('  Keine auswertbaren Minuten (zu wenig Anfragen).');
      continue;
    }
    lines.push(
      `  gemessen: Median ${f(rule.p50)}, 95 % ${f(rule.p95)}, 99 % ${f(rule.p99)}, 99,9 % ${f(rule.p999)}, höchster Wert ${f(rule.max)} (${rule.minutes} Minuten)`,
    );
    lines.push(`  jetzt:    ${f(rule.current)} – hätte ${rule.firedCurrent}× ausgelöst`);
    const yaml = (v: number) => (rule.unit === 'bytes' ? `${v / 1e9}e9` : String(v));
    const change =
      rule.suggested === null || rule.suggested === rule.current
        ? 'unverändert lassen'
        : !report.enoughData
          ? `erst nach ${MIN_DAYS} Tagen Betrieb übernehmen`
          : `in alerts.yml „> ${yaml(rule.current)}“ durch „> ${yaml(rule.suggested)}“ ersetzen (Text in summary und alerts.test.yml mit anpassen)`;
    lines.push(`  Vorschlag: ${f(rule.suggested)} – hätte ${rule.firedSuggested}× ausgelöst; ${change}`);
  }
  lines.push(
    '',
    `EmailVersandFehlgeschlagen: ${report.mailFailures.total} fehlgeschlagene E-Mails an ${report.mailFailures.days} Tagen – die Regel meldet jeden Fehler, keine Schwelle.`,
    `BackendNichtErreichbar: ${report.gaps} Lücken über 2 Minuten im Verlauf (Neustarts eingeschlossen).`,
  );
  return lines.join('\n');
}
