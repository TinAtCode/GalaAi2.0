import {
  calculateDeviation,
  sumPlannedMinutes,
  sumPlannedMaterialCost,
} from '../src/post-calculation/post-calculation.service';

describe('calculateDeviation', () => {
  it('berechnet eine positive Abweichung wie im Beispiel aus Punkt 28 (100h geplant, 117h tatsächlich)', () => {
    const result = calculateDeviation(6000, 7020); // 100h vs 117h in Minuten
    expect(result.planned).toBe(6000);
    expect(result.actual).toBe(7020);
    expect(result.deviationAbs).toBe(1020); // +17h
    expect(result.deviationPercent).toBe(17);
  });

  it('funktioniert identisch für Kostenwerte (Material)', () => {
    const result = calculateDeviation(200, 150); // 200€ geplant, 150€ tatsächlich
    expect(result.deviationAbs).toBe(-50);
    expect(result.deviationPercent).toBe(-25);
  });

  it('liefert deviationPercent = null, wenn keine Sollgröße vorliegt', () => {
    const result = calculateDeviation(0, 120);
    expect(result.deviationPercent).toBeNull();
    expect(result.actual).toBe(120);
  });
});

describe('sumPlannedMinutes / sumPlannedMaterialCost', () => {
  it('summiert mehrere Positionen korrekt', () => {
    expect(
      sumPlannedMinutes([
        { quantity: 10, laborMinutesPerUnit: 20 },
        { quantity: 5, laborMinutesPerUnit: 30 },
      ]),
    ).toBe(350);

    expect(
      sumPlannedMaterialCost([
        { quantity: 10, materialCostPerUnit: 5 },
        { quantity: 2, materialCostPerUnit: 12 },
      ]),
    ).toBe(74);
  });
});
