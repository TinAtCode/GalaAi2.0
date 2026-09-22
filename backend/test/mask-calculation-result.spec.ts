import { maskCalculationResult, CalculationResult } from '../src/common/price-visibility';
import { PERMISSIONS } from '../src/common/permissions';

const result: CalculationResult = {
  materialCostPerUnit: 10,
  laborCostPerUnit: 30,
  overheadPerUnit: 4,
  costPerUnit: 44,
  salePricePerUnit: 52.8,
  marginPerUnit: 8.8,
  quantity: 10,
  materialCostTotal: 100,
  laborCostTotal: 300,
  overheadTotal: 40,
  costTotal: 440,
  salePriceTotal: 528,
  marginTotal: 88,
};

describe('maskCalculationResult', () => {
  it('Mitarbeiter ohne Preisrechte sieht nur die Menge, keine Kosten/Preise', () => {
    const masked = maskCalculationResult(result, [PERMISSIONS.CUSTOMER_READ]);
    expect(masked.quantity).toBe(10);
    expect(masked.costPerUnit).toBeUndefined();
    expect(masked.salePricePerUnit).toBeUndefined();
    expect(masked.marginPerUnit).toBeUndefined();
  });

  it('Vorarbeiter mit price.sale.read sieht Verkaufspreis, aber keine Kostenaufschlüsselung', () => {
    const masked = maskCalculationResult(result, [PERMISSIONS.PRICE_SALE_READ]);
    expect(masked.salePricePerUnit).toBe(52.8);
    expect(masked.salePriceTotal).toBe(528);
    expect(masked.costPerUnit).toBeUndefined();
    expect(masked.materialCostTotal).toBeUndefined();
    expect(masked.marginPerUnit).toBeUndefined();
  });

  it('Büro mit price.purchase.read sieht Kosten, aber ohne price.sale.read keinen Verkaufspreis', () => {
    const masked = maskCalculationResult(result, [PERMISSIONS.PRICE_PURCHASE_READ]);
    expect(masked.costPerUnit).toBe(44);
    expect(masked.materialCostTotal).toBe(100);
    expect(masked.salePricePerUnit).toBeUndefined();
  });

  it('Geschäftsführung mit allen Rechten sieht auch die Marge', () => {
    const masked = maskCalculationResult(result, [
      PERMISSIONS.PRICE_PURCHASE_READ,
      PERMISSIONS.PRICE_SALE_READ,
      PERMISSIONS.PRICE_MARGIN_READ,
    ]);
    expect(masked.marginPerUnit).toBe(8.8);
    expect(masked.marginTotal).toBe(88);
  });
});
