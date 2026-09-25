import { describe, expect, it } from 'vitest';
import { foldSlices } from './DonutChart';

describe('foldSlices', () => {
  const slice = (key: string, value: number) => ({ key, label: key, value });

  it('sortiert nach Größe und lässt leere Posten weg', () => {
    expect(foldSlices([slice('a', 1), slice('b', 0), slice('c', 5)]).map((s) => s.key)).toEqual(['c', 'a']);
  });

  it('fasst ab dem sechsten Posten zu Sonstige zusammen', () => {
    const folded = foldSlices([1, 2, 3, 4, 5, 6, 7].map((v) => slice(`k${v}`, v)));
    expect(folded.map((s) => [s.key, s.value])).toEqual([
      ['k7', 7],
      ['k6', 6],
      ['k5', 5],
      ['k4', 4],
      ['k3', 3],
      ['other', 3],
    ]);
    expect(folded[5]).toMatchObject({ label: 'Sonstige (2)', color: 'var(--chart-other)' });
  });

  it('ein einzelner Rest behält seinen Namen', () => {
    const folded = foldSlices([1, 2, 3, 4, 5, 6].map((v) => slice(`k${v}`, v)));
    expect(folded[5]).toMatchObject({ key: 'other', label: 'k1', value: 1 });
  });
});
