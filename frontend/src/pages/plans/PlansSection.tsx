import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';

interface PlanSummary {
  id: string;
  name: string;
  objectCount: number;
  hasBackground: boolean;
  updatedAt: string;
}

// Lagepläne des Projekts: Liste, neu anlegen, löschen
export function PlansSection({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(
    () =>
      api
        .get<PlanSummary[]>(`/projects/${projectId}/plans`)
        .then(setPlans)
        .catch((err) =>
          setError(err instanceof ApiError ? err.message : 'Pläne konnten nicht geladen werden.'),
        ),
    [projectId],
  );
  useEffect(() => {
    load();
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const plan = await api.post<{ id: string }>(`/projects/${projectId}/plans`, { name: name.trim() });
      navigate(`/projekte/${projectId}/plaene/${plan.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Plan konnte nicht angelegt werden.');
      setBusy(false);
    }
  };

  const remove = async (plan: PlanSummary) => {
    if (!window.confirm(`Plan „${plan.name}“ löschen?`)) return;
    try {
      await api.delete(`/plans/${plan.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen fehlgeschlagen.');
    }
    await load();
  };

  return (
    <section data-testid="plans-section">
      <h3 style={{ marginBottom: 4 }}>Lagepläne</h3>
      <p className="list-item-meta" style={{ marginTop: 0 }}>
        Entwässerung, Leitungen, Flächen, Zäune und Tore einzeichnen – Längen und Flächen werden gemessen.
      </p>
      {error && <p className="field-error">{error}</p>}
      {plans?.length === 0 && <p className="list-item-meta">Noch kein Plan.</p>}
      {plans?.map((plan) => (
        <div key={plan.id} className="list-item" data-testid="plan-item">
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link to={`/projekte/${projectId}/plaene/${plan.id}`} className="list-item-name">
              {plan.name}
            </Link>
            <div className="list-item-meta">
              {plan.objectCount} Objekt{plan.objectCount === 1 ? '' : 'e'}
              {plan.hasBackground && ' · mit Hintergrund'}
            </div>
          </div>
          {canEdit && (
            <button className="btn" onClick={() => remove(plan)}>
              Löschen
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <form onSubmit={create} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8 }}>
          <label className="field" style={{ flex: '1 1 200px', maxWidth: 320 }}>
            <span>Neuer Plan</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Garten Süd"
              maxLength={80}
              data-testid="plan-new-name"
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || name.trim().length < 2}
            data-testid="plan-create"
          >
            Anlegen
          </button>
        </form>
      )}
    </section>
  );
}
