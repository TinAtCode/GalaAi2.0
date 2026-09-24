import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { parseAmount } from '../../format';

interface Candidate {
  id: string;
  name: string;
  unit: string;
  quantity: number;
}

interface DraftRow {
  key: string;
  label: string;
  unit: string;
  quantity: number;
  serviceId: string | null;
  candidates: Candidate[];
}

interface Choice {
  serviceId: string;
  quantity: string;
}

const number = (value: number) => value.toLocaleString('de-DE', { maximumFractionDigits: 3 });

// Mengen des (gespeicherten) Plans als Angebotsentwurf: je Zeile eine
// Leistung derselben Einheit wählen; die Wahl wird für künftige Pläne gemerkt.
// Kalkulation und Rundung übernimmt das Angebot wie bei jeder Leistung.
export function QuoteFromPlan({
  planId,
  projectId,
  onClose,
}: {
  planId: string;
  projectId: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [choice, setChoice] = useState<Record<string, Choice>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get<{ rows: DraftRow[] }>(`/plans/${planId}/quote-draft`)
      .then(({ rows: loaded }) => {
        setRows(loaded);
        setChoice(
          Object.fromEntries(
            loaded.map((r) => {
              const c = r.candidates.find((x) => x.id === r.serviceId);
              return [r.key, { serviceId: c?.id ?? '', quantity: c ? number(c.quantity) : '' }];
            }),
          ),
        );
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Mengen konnten nicht geladen werden.'),
      );
  }, [planId]);

  const pick = (row: DraftRow, serviceId: string) => {
    const c = row.candidates.find((x) => x.id === serviceId);
    setChoice({ ...choice, [row.key]: { serviceId, quantity: c ? number(c.quantity) : '' } });
  };

  const create = async () => {
    if (!rows) return;
    const lines = rows
      .filter((r) => choice[r.key]?.serviceId)
      .map((r) => ({
        row: r,
        serviceId: choice[r.key].serviceId,
        quantity: parseAmount(choice[r.key].quantity),
      }));
    if (lines.length === 0) {
      setError('Bitte mindestens einer Menge eine Leistung zuordnen.');
      return;
    }
    const bad = lines.find((l) => !Number.isFinite(l.quantity) || l.quantity <= 0);
    if (bad) {
      setError(`${bad.row.label}: bitte eine gültige Menge angeben.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // neu gewählte Leistungen merken; "nicht übernehmen" gilt nur für dieses
      // Angebot und lässt die gemerkte Zuordnung stehen
      for (const line of lines) {
        if (line.serviceId !== line.row.serviceId)
          await api.put(`/plan-mappings/${encodeURIComponent(line.row.key)}`, { serviceId: line.serviceId });
      }
      await api.post('/quotes', {
        projectId,
        lineItems: lines.map((l) => ({
          serviceId: l.serviceId,
          quantity: Math.round(l.quantity * 1000) / 1000,
        })),
      });
      navigate(`/projekte/${projectId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Angebot konnte nicht angelegt werden.');
      setBusy(false);
    }
  };

  return (
    <div className="job-card" style={{ display: 'block' }} data-testid="plan-quote">
      <strong>Ins Angebot übernehmen</strong>
      <p className="list-item-meta">
        Je Menge eine Leistung wählen (nur Leistungen mit passender Einheit). Die Zuordnung wird gemerkt;
        gerundet wird wie bei der Leistung eingestellt.
      </p>
      {error && <p className="field-error">{error}</p>}
      {rows === null && !error && <p>Lädt …</p>}
      {rows?.length === 0 && <p className="list-item-meta">Der Plan enthält noch keine Mengen.</p>}
      {rows?.map((r) => (
        <div
          key={r.key}
          style={{ borderTop: '1px solid var(--color-border)', padding: '6px 0' }}
          data-testid="plan-quote-row"
        >
          <div>
            {r.label}: {number(r.quantity)} {r.unit}
          </div>
          {r.candidates.length === 0 ? (
            <div className="list-item-meta">Keine Leistung in {r.unit} – in den Stammdaten anlegen.</div>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              <select
                value={choice[r.key]?.serviceId ?? ''}
                onChange={(e) => pick(r, e.target.value)}
                style={{ flex: '1 1 160px', minWidth: 0 }}
                aria-label={`Leistung für ${r.label}`}
                data-testid="plan-quote-service"
              >
                <option value="">– nicht übernehmen –</option>
                {r.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.unit})
                  </option>
                ))}
              </select>
              {choice[r.key]?.serviceId && (
                <input
                  value={choice[r.key].quantity}
                  onChange={(e) =>
                    setChoice({ ...choice, [r.key]: { ...choice[r.key], quantity: e.target.value } })
                  }
                  inputMode="decimal"
                  style={{ width: 90 }}
                  aria-label={`Menge für ${r.label}`}
                  data-testid="plan-quote-quantity"
                />
              )}
            </div>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          disabled={busy || !rows?.length}
          onClick={create}
          data-testid="plan-quote-create"
        >
          Angebot anlegen
        </button>
        <button className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}
