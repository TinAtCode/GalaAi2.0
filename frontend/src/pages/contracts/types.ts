export type ContractStatus = 'active' | 'paused' | 'ended';
export type BillingInterval = 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';

export interface ContractLine {
  id?: string;
  description: string;
  unit: string;
  quantity: string;
  // ohne price.sale.read nicht vorhanden
  unitPrice?: string;
}

export interface ContractTask {
  id?: string;
  title: string;
  everyWeeks: number;
  seasonFrom: number;
  seasonTo: number;
  startMinutes: number;
  durationMinutes: number;
  assignedUserId: string | null;
  nextDue: string;
}

export interface Contract {
  id: string;
  projectId: string;
  title: string;
  status: ContractStatus;
  startDate: string;
  endDate: string | null;
  billingInterval: BillingInterval;
  billInAdvance: boolean;
  vatRate: string;
  notes: string | null;
  lines: ContractLine[];
  tasks: ContractTask[];
  project: { id: string; title: string; property: { label: string; customer: { name: string } } };
  netPerPeriod?: string;
  nextPeriod: { start: string; end: string } | null;
  billingDue: boolean;
  tasksDue: boolean;
}

export interface Assignee {
  id: string;
  firstName: string;
  lastName: string;
}

export const STATUS_LABELS: Record<ContractStatus, string> = {
  active: 'Aktiv',
  paused: 'Pausiert',
  ended: 'Beendet',
};

export const INTERVAL_LABELS: Record<BillingInterval, string> = {
  monthly: 'monatlich',
  quarterly: 'vierteljährlich',
  halfyearly: 'halbjährlich',
  yearly: 'jährlich',
};

export const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export const day = (iso: string) => iso.slice(0, 10);
export const formatDay = (iso: string) => new Date(`${day(iso)}T12:00:00`).toLocaleDateString('de-DE');

export function taskSummary(task: ContractTask) {
  const every = task.everyWeeks === 1 ? 'jede Woche' : `alle ${task.everyWeeks} Wochen`;
  const season =
    task.seasonFrom === 1 && task.seasonTo === 12
      ? 'ganzjährig'
      : `${MONTHS[task.seasonFrom - 1]}–${MONTHS[task.seasonTo - 1]}`;
  return `${every}, ${season}, nächster Termin ${formatDay(task.nextDue)}`;
}
