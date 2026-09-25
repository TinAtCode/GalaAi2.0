import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { day } from './shared';

interface Note {
  id: string;
  noteNumber: string | null;
  noteDate: string | null;
  supplier: { id: string; name: string } | null;
  project: { id: string; number: string | null; title: string } | null;
  reasons?: ('number' | 'date')[];
}

interface Result {
  linked: Note[];
  suggestions: Note[];
}

// Lieferscheine, die eine Eingangsrechnung abrechnet: zugeordnete abwählen,
// Vorschläge (gleicher Lieferant, Lieferscheinnummer im Beleg) dazunehmen
export function PayableDeliveryNotes({ payableId, onSaved }: { payableId: string; onSaved: () => void }) {
  const [data, setData] = useState<Result | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    api
      .get<Result>(`/finance/payables/${payableId}/delivery-notes`)
      .then((result) => {
        if (!current) return;
        setData(result);
        // Vorschläge mit der Lieferscheinnummer im Beleg gleich vorauswählen
        setSelected(
          new Set([
            ...result.linked.map((n) => n.id),
            ...result.suggestions.filter((n) => n.reasons?.includes('number')).map((n) => n.id),
          ]),
        );
      })
      .catch(
        (err) =>
          current &&
          setError(err instanceof ApiError ? err.message : 'Lieferscheine konnten nicht geladen werden.'),
      );
    return () => {
      current = false;
    };
  }, [payableId]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.put<Result>(`/finance/payables/${payableId}/delivery-notes`, {
        deliveryNoteIds: [...selected],
      });
      setData(result);
      setSelected(new Set(result.linked.map((n) => n.id)));
      setNotice(`${result.linked.length} Lieferschein(e) zugeordnet.`);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const row = (n: Note) => (
    <label key={n.id} className="checkbox-row" data-testid="payable-note" data-id={n.id}>
      <input type="checkbox" checked={selected.has(n.id)} onChange={() => toggle(n.id)} />
      <span>
        {n.supplier?.name ?? 'Lieferant unbekannt'}
        {n.noteNumber && ` · Nr. ${n.noteNumber}`}
        {n.noteDate && ` · ${day(n.noteDate)}`}
        {n.project && (
          <>
            {' · '}
            <Link to={`/projekte/${n.project.id}`}>
              {n.project.number ? `${n.project.number} · ` : ''}
              {n.project.title}
            </Link>
          </>
        )}
        {n.reasons?.includes('number') && <span className="list-item-meta"> (Nummer im Beleg)</span>}
      </span>
    </label>
  );

  return (
    <div className="job-card" style={{ display: 'block', margin: '8px 0' }} data-testid="payable-notes">
      {error && <p className="field-error">{error}</p>}
      {notice && <p className="list-item-meta">{notice}</p>}
      {!data && !error && <p className="list-item-meta">Lädt …</p>}
      {data && (
        <>
          {data.linked.length + data.suggestions.length === 0 ? (
            <p className="list-item-meta">
              Keine passenden Lieferscheine: bestätigte Lieferscheine desselben Lieferanten aus den vier
              Monaten vor dem Rechnungsdatum erscheinen hier.
            </p>
          ) : (
            <>
              {data.linked.map(row)}
              {data.suggestions.length > 0 && (
                <p className="list-item-meta" style={{ margin: '8px 0 4px' }}>
                  Vorschläge
                </p>
              )}
              {data.suggestions.map(row)}
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => void save()}
                  data-testid="payable-notes-save"
                >
                  Zuordnung speichern
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
