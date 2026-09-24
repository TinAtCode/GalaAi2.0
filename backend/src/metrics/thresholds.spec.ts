import { readFileSync } from 'fs';
import { join } from 'path';
import { LATENCY_BUCKETS } from './metrics';
import {
  countFirings,
  formatReport,
  histogramQuantile,
  niceUp,
  RULES,
  Sample,
  thresholdReport,
} from './thresholds';

const START = Date.UTC(2026, 8, 1);
const buckets = (fast: number, slow = 0) => {
  const list = new Array<number>(LATENCY_BUCKETS.length + 1).fill(0);
  list[2] = fast; // bis 100 ms
  list[7] = slow; // 2,5 bis 5 s
  return list;
};
const sample = (minute: number, patch: Partial<Sample> = {}): Sample => ({
  at: new Date(START + minute * 60_000),
  instance: 'a',
  requests: 100,
  serverErrors: 0,
  latencyBuckets: buckets(100),
  eventLoopP99Seconds: 0.02,
  rssBytes: 300e6,
  ocrWaiting: 0,
  mailFailures: 0,
  ...patch,
});

describe('Alarmschwellen aus dem Verlauf', () => {
  it('Perzentil wie histogram_quantile', () => {
    expect(histogramQuantile(0.5, buckets(100))).toBeCloseTo(0.075);
    expect(histogramQuantile(0.95, buckets(10, 90))).toBeGreaterThan(2.5);
    expect(histogramQuantile(0.95, [])).toBeNull();
    const overflow = new Array<number>(LATENCY_BUCKETS.length + 1).fill(0);
    overflow[LATENCY_BUCKETS.length] = 5;
    expect(histogramQuantile(0.95, overflow)).toBe(10);
  });

  it('rundet auf runde Werte auf', () => {
    expect(niceUp(0.031)).toBe(0.04);
    expect(niceUp(1.2)).toBe(1.5);
    expect(niceUp(2)).toBe(2);
    expect(niceUp(612e6)).toBe(800e6);
  });

  it('zählt nur Folgen, die lang genug über der Schwelle liegen', () => {
    const points = [1, 2, 3, 4, 5, 7, 8, 9].map((minute) => ({ minute, key: 'a', value: 5 }));
    // 1–5 am Stück (5 Minuten), 7–9 nur 3 Minuten
    expect(countFirings(points, 4, 5)).toBe(1);
    expect(countFirings(points, 4, 3)).toBe(2);
    expect(countFirings(points, 5, 1)).toBe(0);
  });

  it('wertet Fehlerquote, Antwortzeit, Speicher und Lücken aus', () => {
    const samples: Sample[] = [];
    for (let m = 0; m < 20 * 1440; m += 1) {
      if (m >= 5000 && m < 5010) continue; // Neustart
      const burst = m >= 10_000 && m < 10_015;
      samples.push(
        sample(m, {
          serverErrors: burst ? 20 : m % 100 === 0 ? 1 : 0,
          latencyBuckets: burst ? buckets(10, 90) : buckets(100),
          rssBytes: 300e6 + (m % 1000) * 100_000,
          mailFailures: m === 3000 ? 2 : 0,
        }),
      );
    }
    const report = thresholdReport(samples);
    expect(report.enoughData).toBe(true);
    expect(report.instances).toBe(1);
    expect(report.gaps).toBe(1);
    expect(report.mailFailures).toEqual({ total: 2, days: 1 });

    const errors = report.rules.find((r) => r.alert === 'VieleServerfehler')!;
    // die 15 Minuten mit 20 % Fehlern hätten einmal ausgelöst
    expect(errors.firedCurrent).toBe(1);
    expect(errors.max).toBeCloseTo(0.2);
    expect(errors.suggested).toBeGreaterThanOrEqual(0.01);

    const slow = report.rules.find((r) => r.alert === 'LangsameAntworten')!;
    expect(slow.firedCurrent).toBe(1);
    expect(slow.p50).toBeLessThan(0.1);

    const memory = report.rules.find((r) => r.alert === 'HoherSpeicherverbrauch')!;
    expect(memory.max).toBeCloseTo(399.9e6);
    expect(memory.suggested).toBe(600e6);
    expect(memory.firedSuggested).toBe(0);

    const text = formatReport(report);
    expect(text).toContain('VieleServerfehler');
    expect(text).toContain('1 Lücken');
    expect(text).toContain('„> 1.5e9“ durch „> 0.6e9“');
  });

  it('meldet zu wenig Daten', () => {
    expect(formatReport(thresholdReport([]))).toContain('Noch keine Messpunkte');
    const short = thresholdReport([sample(0), sample(1)]);
    expect(short.enoughData).toBe(false);
    expect(formatReport(short)).toContain('vorläufig');
  });

  // die Werte in RULES müssen zu ops/prometheus/alerts.yml passen
  it('kennt die aktuellen Schwellen aus alerts.yml', () => {
    const yaml = readFileSync(join(__dirname, '../../../ops/prometheus/alerts.yml'), 'utf8');
    for (const rule of RULES) {
      const block = yaml.split(/- alert: /).find((b) => b.startsWith(`${rule.alert}\n`));
      expect(block).toBeDefined();
      const threshold = /expr:[\s\S]*?>\s*([0-9.e+]+)/.exec(block!)?.[1];
      expect(Number(threshold)).toBe(rule.current);
      expect(/for: (\d+)m/.exec(block!)?.[1]).toBe(String(rule.forMinutes));
    }
  });
});
