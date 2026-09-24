import { describe, expect, it } from 'vitest';
import { targetSize } from './photo';

describe('Fotos verkleinern', () => {
  it('längste Seite höchstens 1920 px, Seitenverhältnis bleibt', () => {
    expect(targetSize(4032, 3024)).toEqual({ width: 1920, height: 1440 });
    expect(targetSize(3024, 4032)).toEqual({ width: 1440, height: 1920 });
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
