import { PERMISSIONS } from '../common/permissions';

// Zweite Sicherung: Der aufrufende Teil der App gibt der KI nur Daten mit,
// die der Nutzer selbst sehen darf. Zusätzlich entfernt das Gateway Felder,
// die nach Einkaufspreis, Marge oder Lohn aussehen, wenn das Recht fehlt –
// ein vergessener Filter gibt so trotzdem nichts preis.
const RULES: { permission: string; pattern: RegExp }[] = [
  {
    permission: PERMISSIONS.PRICE_PURCHASE_READ,
    pattern: /^(purchase|cost|einkauf)|(purchase|cost)(price|total|perunit)?$/i,
  },
  { permission: PERMISSIONS.PRICE_MARGIN_READ, pattern: /(margin|markup|marge|aufschlag|profit)/i },
  { permission: PERMISSIONS.EMPLOYEE_DATA_READ, pattern: /(hourlyrate|wage|salary|lohn|gehalt)/i },
];

export const MAX_CONTEXT_BYTES = 100_000;

export function filterContext(value: unknown, permissions: string[]): unknown {
  const hidden = RULES.filter((rule) => !permissions.includes(rule.permission)).map((rule) => rule.pattern);
  const walk = (node: unknown, depth: number): unknown => {
    if (depth > 12) return undefined;
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node)) {
        if (hidden.some((pattern) => pattern.test(key))) continue;
        out[key] = walk(child, depth + 1);
      }
      return out;
    }
    return node;
  };
  return walk(value, 0);
}
