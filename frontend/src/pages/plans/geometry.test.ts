import { describe, expect, it } from 'vitest';
import {
  bearing,
  insertPoint,
  polygonArea,
  removePoint,
  rotateObject,
  scaleObject,
  setListValue,
  setSegmentLength,
} from './geometry';
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

describe('Skalieren', () => {
  it('um die Mitte, Radien und Bögen mit', () => {
    const square = {
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ] as Point[],
      props: { radii: [1, 0, 0, 0], bulges: [0, 0, 5, 0] },
    };
    const big = scaleObject(square, 2);
    expect(big.points).toEqual([
      [-5, -5],
      [15, -5],
      [15, 15],
      [-5, 15],
    ]);
    expect(big.props).toEqual({ radii: [2, 0, 0, 0], bulges: [0, 0, 10, 0] });
  });

  it('Kreis: um den Mittelpunkt', () => {
    const circle = {
      points: [
        [5, 5],
        [8, 5],
      ] as Point[],
      props: { shape: 'circle' as const },
    };
    expect(scaleObject(circle, 0.5).points).toEqual([
      [5, 5],
      [6.5, 5],
    ]);
  });
});

describe('Drehen und Richtung', () => {
  it('dreht um die Mitte, Fläche und Mittelpunkt bleiben', () => {
    const turned = rotateObject({ points: square }, 90);
    const rounded = turned.map(([x, y]) => [Math.round(x) + 0, Math.round(y) + 0]);
    expect(rounded).toEqual([
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ]);
    expect(polygonArea(turned)).toBeCloseTo(10000);
  });

  it('Kreis dreht um den Mittelpunkt, der Radius bleibt', () => {
    const circle = {
      points: [
        [10, 10],
        [20, 10],
      ] as Point[],
      props: { shape: 'circle' as const },
    };
    const [center, edge] = rotateObject(circle, 90);
    expect(center).toEqual([10, 10]);
    expect(edge[0]).toBeCloseTo(10);
    expect(edge[1]).toBeCloseTo(20);
  });

  it('Richtung in Grad im Uhrzeigersinn', () => {
    expect(bearing([0, 0], [10, 0])).toBe(0);
    expect(bearing([0, 0], [0, 10])).toBe(90);
    expect(bearing([0, 0], [-10, 0])).toBe(180);
    expect(bearing([0, 0], [0, -10])).toBe(270);
  });
});
