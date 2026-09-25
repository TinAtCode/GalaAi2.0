export type EquipmentKind = 'vehicle' | 'machine' | 'trailer' | 'tool' | 'other';
export type EquipmentStatus = 'ready' | 'limited' | 'broken';
export type DamageSeverity = 'minor' | 'limited' | 'unusable';
export type DamageStatus = 'open' | 'in_repair' | 'fixed';

export interface Equipment {
  id: string;
  name: string;
  kind: EquipmentKind;
  inventoryNumber: string | null;
  licensePlate: string | null;
  serialNumber: string | null;
  location: string | null;
  status: EquipmentStatus;
  retired: boolean;
  machineId: string | null;
  machine: { id: string; name: string } | null;
  notes: string | null;
  lastInventoryAt: string | null;
  openDamages?: number;
  nextMaintenance?: { title: string; due: string } | null;
}

export interface Damage {
  id: string;
  equipmentId: string;
  description: string;
  severity: DamageSeverity;
  status: DamageStatus;
  repairCost: number | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  equipment?: { id: string; name: string; kind: EquipmentKind };
}

export interface Maintenance {
  id: string;
  title: string;
  intervalMonths: number | null;
  nextDue: string;
  lastDone: string | null;
  notes: string | null;
  active: boolean;
  logs: { id: string; doneOn: string; note: string | null; cost: number | null }[];
}

export interface DueMaintenance {
  id: string;
  title: string;
  due: string;
  overdue: boolean;
  equipment: { id: string; name: string };
}

export const KIND: Record<EquipmentKind, string> = {
  vehicle: 'Fahrzeug',
  machine: 'Maschine',
  trailer: 'Anhänger',
  tool: 'Werkzeug',
  other: 'Sonstiges',
};

export const STATUS: Record<EquipmentStatus, { label: string; badge: string }> = {
  ready: { label: 'einsatzbereit', badge: 'status-done' },
  limited: { label: 'eingeschränkt', badge: 'status-open' },
  broken: { label: 'defekt', badge: 'status-overdue' },
};

export const SEVERITY: Record<DamageSeverity, string> = {
  minor: 'Kleinigkeit (voll nutzbar)',
  limited: 'eingeschränkt nutzbar',
  unusable: 'nicht nutzbar',
};

export const DAMAGE_STATUS: Record<DamageStatus, { label: string; badge: string }> = {
  open: { label: 'offen', badge: 'status-open' },
  in_repair: { label: 'in Reparatur', badge: 'status-in_progress' },
  fixed: { label: 'erledigt', badge: 'status-done' },
};

export const dayText = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('de-DE');
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
