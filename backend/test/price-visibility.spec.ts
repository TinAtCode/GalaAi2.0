import { applyPriceVisibility } from '../src/common/price-visibility';
import { PERMISSIONS } from '../src/common/permissions';

const article = { id: 'art-1', name: 'Naturstein', purchasePrice: 10, salePrice: 25 };

describe('applyPriceVisibility', () => {
  it('Mitarbeiter ohne Preisrechte sieht weder Einkaufs- noch Verkaufspreis', () => {
    const result = applyPriceVisibility(article, [PERMISSIONS.CUSTOMER_READ]);
    expect(result.purchasePrice).toBeUndefined();
    expect(result.salePrice).toBeUndefined();
    expect(result.margin).toBeUndefined();
  });

  it('Vorarbeiter mit nur price.sale.read sieht Verkaufspreis, aber keinen Einkaufspreis/Marge', () => {
    const result = applyPriceVisibility(article, [PERMISSIONS.PRICE_SALE_READ]);
    expect(result.salePrice).toBe(25);
    expect(result.purchasePrice).toBeUndefined();
    expect(result.margin).toBeUndefined();
  });

  it('Geschäftsführung mit allen Preisrechten sieht auch die berechnete Marge', () => {
    const result = applyPriceVisibility(article, [
      PERMISSIONS.PRICE_PURCHASE_READ,
      PERMISSIONS.PRICE_SALE_READ,
      PERMISSIONS.PRICE_MARGIN_READ,
    ]);
    expect(result.purchasePrice).toBe(10);
    expect(result.salePrice).toBe(25);
    expect(result.margin).toBe(15);
  });

  it('Marge wird NICHT ausgeliefert, wenn margin.read fehlt, selbst mit beiden Preisen', () => {
    const result = applyPriceVisibility(article, [
      PERMISSIONS.PRICE_PURCHASE_READ,
      PERMISSIONS.PRICE_SALE_READ,
    ]);
    expect(result.margin).toBeUndefined();
  });
});
