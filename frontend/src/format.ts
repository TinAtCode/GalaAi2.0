// Beträge kommen vom Backend teils als Zahl, teils als Text: Prisma liefert
// Decimal-Spalten (Preise, Summen) als String, z.B. "151.8". String.prototype
// .toLocaleString ignoriert die Währungsoptionen – daher immer erst in eine
// Zahl umwandeln, sonst steht "151.8" statt "151,80 €" auf dem Bildschirm.
export function formatEuro(value?: number | string | null): string {
  if (value === undefined || value === null || value === '') return '–';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '–';
  return amount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}
