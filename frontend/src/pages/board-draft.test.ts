import { describe, expect, it } from 'vitest';
import { addToDraft, applyDraft, draftConflicts, shiftByDays, withPatch } from './board-draft';

const at = (day: string, h: number) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).toISOString();
const appt = (id: string, day: string, from: number, to: number | null, user: string | null = 'u1') => ({
  id,
  title: `Termin ${id}`,
  startTime: at(day, from),
  endTime: to === null ? null : at(day, to),
  status: 'planned',
  assignedUserId: user,
  project: { id: 'p1', title: 'Projekt' },
});

describe('Plantafel-Entwurf', () => {
  it('verschiebt das Ende mit, wenn nur der Beginn geändert wird', () => {
    const a = appt('a', '2026-10-05', 8, 12);
    const moved = withPatch(a, { startTime: at('2026-10-07', 9) });
    expect(moved.endTime).toBe(at('2026-10-07', 13));
    expect(withPatch(a, { assignedUserId: null }).assignedUserId).toBeNull();
  });

  it('eine Änderung zurück zum Ausgangszustand fällt aus dem Entwurf', () => {
    const a = appt('a', '2026-10-05', 8, 12);
    let draft = addToDraft({}, a, { startTime: at('2026-10-06', 8) });
    expect(Object.keys(draft)).toEqual(['a']);
    draft = addToDraft(draft, a, { startTime: a.startTime });
    expect(draft).toEqual({});
  });

  it('um Tage verschieben behält die Uhrzeit', () => {
    expect(shiftByDays(at('2026-10-23', 8), 3)).toBe(at('2026-10-26', 8));
  });

  it('findet Abwesenheit, Überschneidung und Überlast in der Vorschau', () => {
    const list = applyDraft(
      [appt('a', '2026-10-05', 7, 12), appt('b', '2026-10-06', 11, 16), appt('c', '2026-10-07', 8, 12)],
      { b: { startTime: at('2026-10-05', 11) } },
    );
    const conflicts = draftConflicts(
      list,
      [{ userId: 'u1', startDate: '2026-10-07', endDate: '2026-10-09' }],
      {
        u1: 'Max',
      },
    );
    expect(conflicts.map((c) => [c.kind, c.appointmentId, c.day])).toEqual([
      ['overlap', 'b', '2026-10-05'],
      ['overload', 'a', '2026-10-05'],
      ['absent', 'c', '2026-10-07'],
    ]);
    expect(conflicts[0].text).toContain('Max');
  });
});
