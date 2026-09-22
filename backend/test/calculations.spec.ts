import { calculateServiceCost } from '../src/calculations/calculations.service';

// Beispiel angelehnt an Punkt 19: 1 m² Terrasse = Schotter + Arbeitszeit.
describe('calculateServiceCost', () => {
  it('berechnet Material-, Arbeitszeit-, Gemeinkosten und Verkaufspreis korrekt', () => {
    const components = [
      { quantityPer: 2, laborMinutes: null, articlePurchasePrice: 5 }, // 2x Schotter à 5€ = 10€
      { quantityPer: 0, laborMinutes: 30, articlePurchasePrice: null }, // 30 Min Arbeitszeit
    ];

    const result = calculateServiceCost(
      components,
      /* quantity */ 10, // 10 m²
      /* hourlyLaborRate */ 60, // 60€/h
      /* overheadPercent */ 10, // 10%
      /* surchargePercent */ 20, // 20%
    );

    expect(result.materialCostPerUnit).toBe(10); // 2 * 5
    expect(result.laborCostPerUnit).toBe(30); // 30min / 60 * 60€
    expect(result.overheadPerUnit).toBe(4); // (10+30) * 10%
    expect(result.costPerUnit).toBe(44); // 10+30+4
    expect(result.salePricePerUnit).toBe(52.8); // 44 * 1.2
    expect(result.marginPerUnit).toBe(8.8); // 52.8 - 44

    expect(result.costTotal).toBe(440); // 44 * 10
    expect(result.salePriceTotal).toBe(528); // 52.8 * 10
    expect(result.marginTotal).toBe(88); // 8.8 * 10
  });

  it('funktioniert auch ohne Arbeitszeit-Anteil (reiner Materialposten)', () => {
    const components = [{ quantityPer: 1, laborMinutes: null, articlePurchasePrice: 100 }];
    const result = calculateServiceCost(components, 1, 50, 0, 0);

    expect(result.materialCostPerUnit).toBe(100);
    expect(result.laborCostPerUnit).toBe(0);
    expect(result.costPerUnit).toBe(100);
    expect(result.salePricePerUnit).toBe(100);
    expect(result.marginPerUnit).toBe(0);
  });

  it('rundet konsistent auf 2 Nachkommastellen', () => {
    const components = [{ quantityPer: 1, laborMinutes: 10, articlePurchasePrice: 3.333 }];
    const result = calculateServiceCost(components, 3, 33.33, 12.5, 17.7);

    // Kein exaktes Erwartungsergebnis nötig – nur sicherstellen, dass
    // niemals mehr als 2 Nachkommastellen entstehen (mit Tolueranz für
    // Floating-Point-Rundungsfehler wie 434.99999999994).
    for (const value of Object.values(result)) {
      if (typeof value === 'number') {
        const scaled = value * 100;
        expect(Math.abs(scaled - Math.round(scaled))).toBeLessThan(1e-6);
      }
    }
  });

  it('rundet Zwischenwerte nicht (kein Aufsummieren von Rundungsfehlern über die Menge)', () => {
    // 0,3333 × 1,99 € = 0,663267 € Material je m². Früher wurde das zuerst auf
    // 0,66 € gerundet, dann Gemeinkosten und Aufschlag darauf gerechnet:
    // Verkaufspreis 0,91 €/m² statt richtig 0,92 €/m² – bei 1.000 m² 10 € zu wenig.
    const components = [{ quantityPer: 0.3333, laborMinutes: null, articlePurchasePrice: 1.99 }];
    const result = calculateServiceCost(components, 1000, 45, 15, 20);

    expect(result.costPerUnit).toBe(0.76); // exakt 0,76275705
    expect(result.salePricePerUnit).toBe(0.92); // exakt 0,91530846
    expect(result.salePriceTotal).toBe(920); // = gerundeter Einzelpreis × Menge (nachrechenbar)
    expect(result.costTotal).toBe(762.76); // früher 760 (0,76 × 1000)
    expect(result.marginTotal).toBe(157.24);
  });

  it('rundet kaufmännisch und ohne Floating-Point-Fehler', () => {
    // 1,005 € ist als JavaScript-Zahl 1,00499999… und würde mit Math.round auf 1,00 fallen.
    const components = [{ quantityPer: 1, laborMinutes: null, articlePurchasePrice: 1.005 }];
    const result = calculateServiceCost(components, 1, 0, 0, 0);

    expect(result.costPerUnit).toBe(1.01);
    expect(result.salePricePerUnit).toBe(1.01);
  });
});
