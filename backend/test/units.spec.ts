import { Prisma } from '@prisma/client';
import {
  convertQuantity,
  normalizeUnit,
  resolveRounding,
  roundQuantity,
  unitCodeForInvoice,
  unitRule,
} from '../src/common/units';

const company = { decimals: 2, mode: 'half_up' as const };
const round = (value: string, levels: Parameters<typeof resolveRounding>[0]) =>
  roundQuantity(value, resolveRounding(levels)).toString();

describe('Einheiten', () => {
  it('erkennt übliche Schreibweisen und liefert den E-Rechnungs-Code', () => {
    expect(['qm', 'm2', 'M²', ' m² '].map(normalizeUnit)).toEqual(['m²', 'm²', 'm²', 'm²']);
    expect(['cbm', 'm3'].map(normalizeUnit)).toEqual(['m³', 'm³']);
    expect(['Stück', 'stk', 'St'].map(normalizeUnit)).toEqual(['Stk', 'Stk', 'Stk']);
    expect(normalizeUnit('Rolle')).toBe('Rolle'); // unbekannt: bleibt
    expect(unitCodeForInvoice('qm')).toBe('MTK');
    expect(unitCodeForInvoice('Rolle')).toBe('C62');
  });

  it('rechnet innerhalb einer Dimension um, nicht über Dimensionen hinweg', () => {
    expect(convertQuantity(250, 'cm', 'm')!.toString()).toBe('2.5');
    expect(convertQuantity(12, 'mm', 'm')!.toString()).toBe('0.012');
    expect(convertQuantity(15000, 'cm²', 'm²')!.toString()).toBe('1.5');
    expect(convertQuantity(2.4, 't', 'kg')!.toString()).toBe('2400');
    expect(convertQuantity(500, 'l', 'm³')!.toString()).toBe('0.5');
    expect(convertQuantity(1, 'm³', 't')).toBeNull();
    expect(convertQuantity(1, 'psch', 'psch')).toBeNull();
  });
});

describe('Rundung der Mengen', () => {
  it('Firma als Standard, kaufmännisch', () => {
    expect(round('12.345', { company })).toBe('12.35');
    expect(round('12.344', { company })).toBe('12.34');
  });

  it('Einheit vor Firma: Stück ganzzahlig, Sack immer aufrunden', () => {
    expect(round('7.2', { unit: unitRule('Stk'), company })).toBe('7');
    expect(round('7.2', { unit: unitRule('Sack'), company })).toBe('8');
    // unbekannte Einheit: Firma
    expect(round('7.256', { unit: unitRule('Rolle'), company })).toBe('7.26');
    // Firma passt die Einheit an: m² mit 1 Nachkommastelle
    expect(round('12.34', { unit: unitRule('m²', { decimals: 1 }), company })).toBe('12.3');
  });

  it('Artikel/Leistung vor Einheit: Pflaster auf ganze m² aufrunden', () => {
    const master = { decimals: 0, mode: 'up' as const };
    expect(round('12.1', { master, unit: unitRule('m²'), company })).toBe('13');
    const rule = resolveRounding({ master, unit: unitRule('m²'), company });
    expect(rule.source).toBe('master');
  });

  it('Position vor allem; ihre Genauigkeit ersetzt einen Schritt am Artikel', () => {
    const master = { step: 0.5, mode: 'up' as const };
    expect(round('3.1', { master, company })).toBe('3.5');
    const position = { decimals: 2 };
    const rule = resolveRounding({ position, master, company });
    expect(rule).toMatchObject({ decimals: 2, step: null, mode: 'up', source: 'position' });
    expect(roundQuantity('3.1', rule).toString()).toBe('3.1');
  });

  it('Schritte (0,25 h, 0,5 m) und nie auf 0', () => {
    expect(round('1.1', { master: { step: 0.25 }, company })).toBe('1');
    expect(round('1.2', { master: { step: 0.25, mode: 'up' }, company })).toBe('1.25');
    expect(round('0.2', { master: { decimals: 0 }, company })).toBe('1');
    expect(round('0.1', { master: { step: 0.5 }, company })).toBe('0.5');
    expect(
      roundQuantity(new Prisma.Decimal('0.0004'), { decimals: 3, mode: 'half_up', step: null }).toString(),
    ).toBe('0.001');
  });
});
