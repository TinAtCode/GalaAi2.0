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

// "3.570,50", "3570,50" und "1.500" (Tausenderpunkt) -> deutsche Schreibweise;
// "3570.50" (Punkt als Dezimaltrenner) bleibt 3570.5
export const parseAmount = (input: string) => {
  const value = input.trim();
  const germanThousands = /^\d{1,3}(\.\d{3})+$/.test(value);
  return Number(value.includes(',') || germanThousands ? value.replace(/\./g, '').replace(',', '.') : value);
};
