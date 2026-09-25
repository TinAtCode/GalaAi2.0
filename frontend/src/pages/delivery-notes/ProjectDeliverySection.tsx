import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import type { DeliveryNote } from './DeliveryNotesPage';

interface Mail {
  to: string;
  subject: string;
  body: string;
  mailto: string;
}

const day = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');

// Am Projekt: zugeordnete Lieferscheine und ein Mail-Entwurf, mit dem die
// Lieferanten die Projektnummer vorab erfahren
export function ProjectDeliverySection({ projectId, showNotes }: { projectId: string; showNotes: boolean }) {
  const [notes, setNotes] = useState<DeliveryNote[] | null>(null);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; email: string | null }[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [mail, setMail] = useState<Mail | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (showNotes)
      api
        .get<DeliveryNote[]>(`/projects/${projectId}/delivery-notes`)
        .then(setNotes)
        .catch(() => setNotes([]));
    api
      .get<{ id: string; name: string; email: string | null; active: boolean }[]>('/suppliers')
      .then((list) => setSuppliers(list.filter((s) => s.active)))
      .catch(() => setSuppliers([]));
  }, [projectId, showNotes]);

  const draft = async (id: string) => {
    setSupplierId(id);
    setMail(null);
    setMessage(null);
    if (!id) return;
    try {
      setMail(await api.get<Mail>(`/projects/${projectId}/supplier-mail?supplierId=${id}`));
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Entwurf konnte nicht erstellt werden.');
    }
  };

  const copy = async () => {
    if (!mail) return;
    try {
      await navigator.clipboard.writeText(`${mail.subject}\n\n${mail.body}`);
      setMessage('Text kopiert.');
    } catch {
      setMessage('Kopieren nicht möglich – bitte den Text markieren.');
    }
  };

  return (
    <div data-testid="project-delivery">
      <h3 style={{ marginTop: 0 }}>Lieferungen</h3>
      {showNotes && (
        <>
          {notes?.length === 0 && (
            <p className="list-item-meta">
              Noch keine Lieferscheine. Hochladen im <Link to="/lieferscheine">Eingang Lieferscheine</Link>.
            </p>
          )}
          <div className="list">
            {notes?.map((n) => (
              <div key={n.id} className="list-item" data-testid="project-delivery-note">
                <div>
                  <div className="list-item-name">
                    {n.supplier?.name ?? 'Lieferant unbekannt'}
                    {n.noteNumber && <span className="list-item-meta"> · Nr. {n.noteNumber}</span>}
                  </div>
                  <div className="list-item-meta">
                    {n.noteDate ? day(n.noteDate) : day(n.document.createdAt)}
                    {n.status === 'open'
                      ? ' · noch nicht bestätigt'
                      : n.incomingInvoiceId
                        ? ' · abgerechnet'
                        : ' · noch ohne Rechnung'}
                  </div>
                </div>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => void api.openFile(`/documents/${n.document.id}/download`)}
                >
                  Ansehen
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 12 }}>
        <label className="field">
          <span>Lieferanten informieren (Projektnummer und Lieferadresse vorab mitteilen)</span>
          <select
            value={supplierId}
            onChange={(e) => void draft(e.target.value)}
            data-testid="supplier-mail-select"
          >
            <option value="">– Lieferant wählen –</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {!s.email && ' (ohne E-Mail)'}
              </option>
            ))}
          </select>
        </label>
        {message && <p className="list-item-meta">{message}</p>}
        {mail && (
          <div className="card" style={{ marginTop: 8 }} data-testid="supplier-mail">
            <div className="list-item-meta">An: {mail.to || '– keine E-Mail hinterlegt –'}</div>
            <div className="list-item-name" style={{ margin: '4px 0' }}>
              {mail.subject}
            </div>
            <pre
              style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}
              data-testid="supplier-mail-body"
            >
              {mail.body}
            </pre>
            <div className="btn-row" style={{ marginTop: 8 }}>
              <a className="btn btn-primary" href={mail.mailto} data-testid="supplier-mail-open">
                Im Mail-Programm öffnen
              </a>
              <button className="btn" onClick={() => void copy()}>
                Text kopieren
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
