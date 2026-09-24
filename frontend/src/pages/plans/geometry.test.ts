import { describe, expect, it } from 'vitest';
import { insertPoint, removePoint, setListValue, setSegmentLength } from './geometry';
import { Point } from './geometry';

const square: Point[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

describe('Punkte einfügen und löschen', () => {
  it('Einfügen verschiebt fixierte Punkte und teilt Bögen', () => {
    const { points, props } = insertPoint(
      square,
      { fixed: [2], radii: [1, 0, 0, 0], bulges: [0, 5, 0, 0] },
      1,
      [100, 50],
    );
    expect(points).toHaveLength(5);
    expect(points[2]).toEqual([100, 50]);
    expect(props).toEqual({ fixed: [3], radii: [1, 0, 0, 0, 0], bulges: [0, 5, 5, 0, 0] });
  });

  it('Löschen verschmilzt die Kanten und hält Mindestpunkte ein', () => {
    const result = removePoint(square, { fixed: [0, 3], radii: [0, 2, 0, 0], bulges: [3, 4, 0, 0] }, 1, true);
    expect(typeof result).not.toBe('string');
    if (typeof result === 'string') return;
    expect(result.points).toEqual([square[0], square[2], square[3]]);
    expect(result.props).toEqual({ fixed: [0, 2], radii: undefined, bulges: undefined });
    expect(removePoint(square.slice(0, 3), undefined, 0, true)).toMatch(/drei Punkte/);
    expect(removePoint(square.slice(0, 2), undefined, 0, false)).toMatch(/zwei Punkte/);
  });

  it('Listenwerte: fehlende Liste mit Nullen, nur Nullen fallen weg', () => {
    expect(setListValue(undefined, 3, 1, 2)).toEqual([0, 2, 0]);
    expect(setListValue([0, 2, 0], 3, 1, 0)).toBeUndefined();
  });

  it('Kantenlänge: Rechteck bleibt rechteckig', () => {
    const next = setSegmentLength(square, [0, 1], true, 150);
    expect(next).toEqual([
      [0, 0],
      [150, 0],
      [150, 100],
      [0, 100],
    ]);
  });
});
