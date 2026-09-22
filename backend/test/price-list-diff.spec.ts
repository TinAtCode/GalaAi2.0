import { diffPriceList } from '../src/data-guardian/price-list-diff';

describe('diffPriceList', () => {
  it('erkennt neue Artikel', () => {
    const diff = diffPriceList(
      [],
      [{ articleNumber: 'A-1', name: 'Schotter', unit: 'Sack', purchasePrice: 5, salePrice: 8 }],
    );
    expect(diff.newArticles).toHaveLength(1);
    expect(diff.priceChanges).toHaveLength(0);
  });

  it('erkennt Preisänderungen bei Einkaufs- UND Verkaufspreis getrennt', () => {
    const diff = diffPriceList(
      [{ articleNumber: 'A-1', name: 'Schotter', unit: 'Sack', purchasePrice: 5, salePrice: 8 }],
      [{ articleNumber: 'A-1', name: 'Schotter', unit: 'Sack', purchasePrice: 5.5, salePrice: 9 }],
    );
    expect(diff.priceChanges).toHaveLength(2);
    expect(diff.priceChanges.find((c) => c.field === 'purchasePrice')?.newValue).toBe(5.5);
    expect(diff.priceChanges.find((c) => c.field === 'salePrice')?.newValue).toBe(9);
  });

  it('erkennt eine geänderte Einheit', () => {
    const diff = diffPriceList(
      [{ articleNumber: 'A-1', name: 'Splitt', unit: 'kg', purchasePrice: 1, salePrice: 2 }],
      [{ articleNumber: 'A-1', name: 'Splitt', unit: 'Sack', purchasePrice: 1, salePrice: 2 }],
    );
    expect(diff.unitChanges).toHaveLength(1);
    expect(diff.unitChanges[0]).toMatchObject({ oldUnit: 'kg', newUnit: 'Sack' });
  });

  it('zählt unveränderte Artikel separat, ohne sie in den Änderungslisten zu führen', () => {
    const diff = diffPriceList(
      [{ articleNumber: 'A-1', name: 'Splitt', unit: 'kg', purchasePrice: 1, salePrice: 2 }],
      [{ articleNumber: 'A-1', name: 'Splitt', unit: 'kg', purchasePrice: 1, salePrice: 2 }],
    );
    expect(diff.unchangedCount).toBe(1);
    expect(diff.priceChanges).toHaveLength(0);
    expect(diff.unitChanges).toHaveLength(0);
  });

  it('ignoriert Floating-Point-Rauschen unterhalb der Toleranz', () => {
    const diff = diffPriceList(
      [{ articleNumber: 'A-1', name: 'Splitt', unit: 'kg', purchasePrice: 0.1 + 0.2, salePrice: 2 }],
      [{ articleNumber: 'A-1', name: 'Splitt', unit: 'kg', purchasePrice: 0.3, salePrice: 2 }],
    );
    expect(diff.priceChanges).toHaveLength(0);
    expect(diff.unchangedCount).toBe(1);
  });

  it('gemischtes Beispiel: neue Artikel, Preis- und Einheitenänderung gleichzeitig', () => {
    const existing = [
      { articleNumber: 'A-1', name: 'Schotter', unit: 'Sack', purchasePrice: 5, salePrice: 8 },
      { articleNumber: 'A-2', name: 'Splitt', unit: 'kg', purchasePrice: 1, salePrice: 2 },
    ];
    const incoming = [
      { articleNumber: 'A-1', name: 'Schotter', unit: 'Sack', purchasePrice: 5.5, salePrice: 8 }, // Preisänderung
      { articleNumber: 'A-2', name: 'Splitt', unit: 'Sack', purchasePrice: 1, salePrice: 2 }, // Einheitenänderung
      { articleNumber: 'A-3', name: 'Rindenmulch', unit: 'Sack', purchasePrice: 3, salePrice: 6 }, // neu
    ];
    const diff = diffPriceList(existing, incoming);

    expect(diff.newArticles).toHaveLength(1);
    expect(diff.priceChanges).toHaveLength(1);
    expect(diff.unitChanges).toHaveLength(1);
    expect(diff.unchangedCount).toBe(0);
  });
});
