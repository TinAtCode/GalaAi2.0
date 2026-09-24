// Gemeinsame Typen und Formatierung der Finanz-Reiter

export interface Category {
  id: string;
  name: string;
  transactions: number;
  rules: { id: string; pattern: string; field: RuleField }[];
}

export type RuleField = 'any' | 'counterparty' | 'remittance' | 'iban';
export type Interval = 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';

export const INTERVALS: { value: Interval; label: string }[] = [
  { value: 'monthly', label: 'monatlich' },
  { value: 'quarterly', label: 'vierteljährlich' },
  { value: 'halfyearly', label: 'halbjährlich' },
  { value: 'yearly', label: 'jährlich' },
];
export const intervalLabel = (interval: Interval) => INTERVALS.find((i) => i.value === interval)!.label;

const MONTH_NAMES = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const monthLabel = (month: string) =>
  `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`;
export const day = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');
