// Plantafel-Entwurf ("was wäre wenn"): Verschiebungen werden erst gesammelt,
// als Vorschau angezeigt und auf Konflikte geprüft; erst "Übernehmen"
// schreibt sie. Reine Funktionen – ohne Server, gut prüfbar.

export interface DraftAppointment {
  id: string;
  title: string;
  startTime: string;
  endTime: string | null;
  status: string;
  assignedUserId: string | null;
  project: { id: string; title: string };
}

export interface DraftAbsence {
  userId: string;
  startDate: string;
  endDate: string;
}

// Änderung je Termin, wie sie später an PATCH /appointments/:id geht
export interface DraftPatch {
  startTime?: string;
  endTime?: string | null;
  assignedUserId?: string | null;
}

export type Draft = Record<string, DraftPatch>;

const localDay = (value: string) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Termin mit Entwurf: ohne neues Ende verschiebt sich das Ende mit (Dauer bleibt)
export function withPatch<T extends DraftAppointment>(appointment: T, patch?: DraftPatch): T {
  if (!patch) return appointment;
  const next = { ...appointment };
  if (patch.startTime) {
    next.startTime = patch.startTime;
    if (patch.endTime === undefined && appointment.endTime) {
      const shift = new Date(patch.startTime).getTime() - new Date(appointment.startTime).getTime();
      next.endTime = new Date(new Date(appointment.endTime).getTime() + shift).toISOString();
    }
  }
  if (patch.endTime !== undefined) next.endTime = patch.endTime;
  if (patch.assignedUserId !== undefined) next.assignedUserId = patch.assignedUserId;
  return next;
}

export function applyDraft<T extends DraftAppointment>(appointments: T[], draft: Draft): T[] {
  return appointments.map((a) => withPatch(a, draft[a.id]));
}

// Änderung zum Entwurf hinzufügen; führt sie zum Ausgangszustand zurück, fällt sie weg
export function addToDraft(draft: Draft, original: DraftAppointment, patch: DraftPatch): Draft {
  const merged: DraftPatch = { ...draft[original.id], ...patch };
  const result = withPatch(original, merged);
  const unchanged =
    result.startTime === original.startTime &&
    result.endTime === original.endTime &&
    result.assignedUserId === original.assignedUserId;
  const next = { ...draft };
  if (unchanged) delete next[original.id];
  else next[original.id] = merged;
  return next;
}

// um n Tage verschieben (Uhrzeit bleibt, auch über die Zeitumstellung)
export function shiftByDays(value: string, days: number) {
  const d = new Date(value);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export type ConflictKind = 'absent' | 'overlap' | 'overload';
export interface Conflict {
  kind: ConflictKind;
  appointmentId: string;
  day: string;
  userId: string;
  text: string;
}

// Konflikte der Vorschau: zugeteilt trotz Abwesenheit, Überschneidung beim
// selben Mitarbeiter, mehr als 8 Stunden an einem Tag
export function draftConflicts(
  appointments: DraftAppointment[],
  absences: DraftAbsence[],
  names: Record<string, string> = {},
): Conflict[] {
  const conflicts: Conflict[] = [];
  const active = appointments.filter((a) => a.status !== 'cancelled' && a.assignedUserId);
  const end = (a: DraftAppointment) =>
    a.endTime ? new Date(a.endTime).getTime() : new Date(a.startTime).getTime() + 3_600_000;
  const byUserDay = new Map<string, DraftAppointment[]>();
  for (const a of active) {
    const key = `${a.assignedUserId}|${localDay(a.startTime)}`;
    byUserDay.set(key, [...(byUserDay.get(key) ?? []), a]);
  }
  for (const [key, list] of byUserDay) {
    const [userId, day] = key.split('|');
    const who = names[userId] ?? 'Mitarbeiter';
    const absence = absences.find((ab) => ab.userId === userId && ab.startDate <= day && ab.endDate >= day);
    if (absence)
      for (const a of list)
        conflicts.push({
          kind: 'absent',
          appointmentId: a.id,
          day,
          userId,
          text: `${who} ist abwesend: ${a.title}`,
        });
    const sorted = [...list].sort((x, y) => x.startTime.localeCompare(y.startTime));
    for (let i = 1; i < sorted.length; i++)
      if (new Date(sorted[i].startTime).getTime() < end(sorted[i - 1]))
        conflicts.push({
          kind: 'overlap',
          appointmentId: sorted[i].id,
          day,
          userId,
          text: `${who}: „${sorted[i - 1].title}“ und „${sorted[i].title}“ überschneiden sich`,
        });
    const hours = list.reduce((sum, a) => sum + (end(a) - new Date(a.startTime).getTime()) / 3_600_000, 0);
    if (hours > 8)
      conflicts.push({
        kind: 'overload',
        appointmentId: sorted[0].id,
        day,
        userId,
        text: `${who}: ${hours.toLocaleString('de-DE', { maximumFractionDigits: 1 })} h an einem Tag`,
      });
  }
  return conflicts;
}
