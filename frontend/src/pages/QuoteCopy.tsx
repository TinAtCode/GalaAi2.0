import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { parseAmount } from '../format';

interface CustomerProjects {
  properties: { label: string; projects: { id: string; title: string; status: string }[] }[];
}

// Angebot als neuen Entwurf kopieren – in dieses oder ein anderes Projekt
// desselben Kunden (z.B. Pflege vom Vorjahr ins neue Jahresprojekt)
export function QuoteCopy({
  quoteId,
  customerId,
  projectId,
  onCopied,
  onCancel,
}: {
  quoteId: string;
  customerId: string;
  projectId: string;
  onCopied: (targetProjectId: string) => void;
  onCancel: () => void;
}) {
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [target, setTarget] = useState(projectId);
  const [percent, setPercent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    api
      .get<CustomerProjects>(`/customers/${customerId}`)
      .then((c) => {
        if (!current) return;
        setOptions(
          c.properties.flatMap((p) =>
            p.projects
              .filter((pr) => pr.status !== 'cancelled' || pr.id === projectId)
              .map((pr) => ({ id: pr.id, label: `${pr.title} (${p.label})` })),
          ),
        );
      })
      .catch(() => current && setOptions([]));
    return () => {
      current = false;
    };
  }, [customerId, projectId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = percent.trim() ? parseAmount(percent) : 0;
    if (Number.isNaN(value) || value < -50 || value > 100) {
      setError('Anpassung bitte zwischen -50 und 100 % angeben.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/quotes/${quoteId}/copy`, {
        projectId: target,
        ...(value ? { freeLinePercent: value } : {}),
      });
      onCopied(target);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kopieren fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="job-card"
      style={{ display: 'block', marginTop: 10 }}
      data-testid="quote-copy-form"
    >
      <p className="list-item-meta" style={{ marginTop: 0 }}>
        Neuer Entwurf: Leistungen aus dem Katalog mit den aktuellen Preisen, freie Positionen mit dem
        bisherigen Preis (optional angepasst).
      </p>
      {error && <p className="field-error">{error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '2 1 220px' }}>
          <span>In Projekt</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)} data-testid="quote-copy-project">
            {options.length === 0 && <option value={projectId}>dieses Projekt</option>}
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.id === projectId ? `${o.label} – dieses Projekt` : o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: '1 1 140px' }}>
          <span>Freie Positionen ± %</span>
          <input
            inputMode="decimal"
            placeholder="z.B. 5"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            data-testid="quote-copy-percent"
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="quote-copy-submit">
          Kopieren
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
