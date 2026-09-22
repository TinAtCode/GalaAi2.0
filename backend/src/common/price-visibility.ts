import { PERMISSIONS } from './permissions';

interface ArticleLikePrices {
  purchasePrice: unknown;
  salePrice: unknown;
}

// Wird von Articles- und Services-Modul genutzt. Filtert NICHT nur im
// Frontend, sondern entfernt die Felder serverseitig aus der Response –
// wer keine Berechtigung hat, bekommt die Werte gar nicht erst geschickt.
// Die Marge wird nur berechnet und ausgeliefert, wenn der User sowohl beide
// Preise als auch explizit price.margin.read besitzt.
export function applyPriceVisibility<T extends ArticleLikePrices>(
  entity: T,
  userPermissions: string[],
): Partial<T> & { margin?: number } {
  const canSeePurchase = userPermissions.includes(PERMISSIONS.PRICE_PURCHASE_READ);
  const canSeeSale = userPermissions.includes(PERMISSIONS.PRICE_SALE_READ);
  const canSeeMargin = userPermissions.includes(PERMISSIONS.PRICE_MARGIN_READ);

  const result: Partial<T> & { margin?: number } = { ...entity };

  if (!canSeePurchase) delete (result as any).purchasePrice;
  if (!canSeeSale) delete (result as any).salePrice;

  if (canSeeMargin && canSeePurchase && canSeeSale) {
    const purchase = Number(entity.purchasePrice);
    const sale = Number(entity.salePrice);
    result.margin = Math.round((sale - purchase) * 100) / 100;
  }

  return result;
}

export interface CalculationResult {
  materialCostPerUnit: number;
  laborCostPerUnit: number;
  overheadPerUnit: number;
  costPerUnit: number;
  salePricePerUnit: number;
  marginPerUnit: number;
  quantity: number;
  materialCostTotal: number;
  laborCostTotal: number;
  overheadTotal: number;
  costTotal: number;
  salePriceTotal: number;
  marginTotal: number;
}

// Dieselbe Logik wie applyPriceVisibility, aber für ein berechnetes
// Kalkulationsergebnis statt für ein einzelnes Article-Objekt: Kostenfelder
// (Material/Arbeitszeit/Gemeinkosten/Gesamtkosten basieren auf dem
// Einkaufspreis) brauchen price.purchase.read, Verkaufspreis braucht
// price.sale.read, Marge zusätzlich price.margin.read.
export function maskCalculationResult(
  result: CalculationResult,
  userPermissions: string[],
): Partial<CalculationResult> {
  const canSeePurchase = userPermissions.includes(PERMISSIONS.PRICE_PURCHASE_READ);
  const canSeeSale = userPermissions.includes(PERMISSIONS.PRICE_SALE_READ);
  const canSeeMargin = userPermissions.includes(PERMISSIONS.PRICE_MARGIN_READ);

  const masked: Partial<CalculationResult> = { quantity: result.quantity };

  if (canSeePurchase) {
    masked.materialCostPerUnit = result.materialCostPerUnit;
    masked.laborCostPerUnit = result.laborCostPerUnit;
    masked.overheadPerUnit = result.overheadPerUnit;
    masked.costPerUnit = result.costPerUnit;
    masked.materialCostTotal = result.materialCostTotal;
    masked.laborCostTotal = result.laborCostTotal;
    masked.overheadTotal = result.overheadTotal;
    masked.costTotal = result.costTotal;
  }

  if (canSeeSale) {
    masked.salePricePerUnit = result.salePricePerUnit;
    masked.salePriceTotal = result.salePriceTotal;
  }

  if (canSeeMargin && canSeePurchase && canSeeSale) {
    masked.marginPerUnit = result.marginPerUnit;
    masked.marginTotal = result.marginTotal;
  }

  return masked;
}
