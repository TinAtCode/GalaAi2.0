import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';

export interface DeliveryNote {
  id: string;
  status: 'open' | 'confirmed';
  noteNumber: string | null;
  noteDate: string | null;
  hints: { supplier?: string; project?: string } | null;
  document: { id: string; fileName: string; createdAt: string; ocrStatus: string | null };
  supplier: { id: string; name: string } | null;
  project: { id: string; number: string | null; title: string } | null;
  // gesetzt, sobald eine Eingangsrechnung den Lieferschein abrechnet
  incomingInvoiceId: string | null;
}

interface Option {
  id: string;
  label: string;
}

const day = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');

// Eingang Lieferscheine: hochladen (auch Foto vom Handy), GartenAI schlägt
// Lieferant und Projekt vor, das Büro bestätigt oder korrigiert.
export function DeliveryNotesPage() {
  const [notes, setNotes] = useState<DeliveryNote[] | null>(null);
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(
    () =>
      api
        .get<DeliveryNote[]>('/delivery-notes')
        .then(setNotes)
        .catch(() => setMessage({ ok: false, text: 'Lieferscheine konnten nicht geladen werden.' })),
    [],
  );
  useEffect(() => {
    void load();
    api
      .get<{ id: string; name: string; active: boolean }[]>('/suppliers')
      .then((list) => setSuppliers(list.filter((s) => s.active).map((s) => ({ id: s.id, label: s.name }))))
      .catch(() => setSuppliers([]));
    api
      .getPage<{ id: string; number: string | null; title: string }>('/projects', 200, 0)
      .then(({ items: list }) =>
        setProjects(list.map((p) => ({ id: p.id, label: `${p.number ? `${p.number} · ` : ''}${p.title}` }))),
      )
      .catch(() => setProjects([]));
  }, [load]);

  // Texterkennung läuft im Hintergrund: solange noch etwas in Arbeit ist, nachladen
  const pending = notes === null || uploading;
  useEffect(() => {
    if (pending) return;
    const inWork = notes?.some(
      (n) => n.document.ocrStatus === 'queued' || n.document.ocrStatus === 'running',
    );
    if (!inWork) return;
    const timer = window.setTimeout(() => void load(), 2000);
    return () => window.clearTimeout(timer);
  }, [notes, pending, load]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setMessage(null);
    try {
      for (const file of Array.from(files)) {
        await api.upload('/documents/upload?ocr=1&documentType=delivery_note', file);
      }
      setMessage({ ok: true, text: 'Hochgeladen – der Text wird erkannt, gleich erscheint der Vorschlag.' });
      // der Vorschlag entsteht nach der Texterkennung; kurz warten und nachladen
      window.setTimeout(() => void load(), 1500);
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Hochladen fehlgeschlagen.' });
    } finally {
      setUploading(false);
    }
  };

  const open = notes?.filter((n) => n.status === 'open') ?? [];
  const confirmed = notes?.filter((n) => n.status === 'confirmed') ?? [];

  return (
    <div data-testid="delivery-notes">
      <header className="page-header">
        <h2>Lieferscheine</h2>
        <label className="btn btn-primary">
          {uploading ? 'Lädt hoch …' : 'Lieferschein hochladen'}
          <input
            type="file"
            accept="application/pdf,image/*"
            capture="environment"
            multiple
            hidden
            onChange={(e) => void upload(e.target.files)}
            data-testid="delivery-upload"
          />
        </label>
      </header>
      <p className="list-item-meta">
        Die App liest den Lieferschein und schlägt Lieferant und Projekt vor: an der Projektnummer (P-…), der
        Lieferadresse oder der Kommission. Bitte prüfen und bestätigen – dann hängt der Lieferschein am
        Projekt. Tipp: Den Lieferanten die Projektnummer vorab mitteilen (im Projekt „Lieferanten
        informieren“).
      </p>
      {message && (
        <p className={message.ok ? 'notice' : 'field-error'} data-testid="delivery-message">
          {message.text}
        </p>
      )}
      {notes === null && !message && <p>Lädt …</p>}

      <h3>Zu prüfen ({open.length})</h3>
      {notes && open.length === 0 && <div className="empty-state">Keine offenen Lieferscheine.</div>}
      {open.map((n) => (
        <NoteCard
          key={n.id}
          note={n}
          suppliers={suppliers}
          projects={projects}
          onSaved={(text) => {
            setMessage({ ok: true, text });
            void load();
          }}
          onError={(text) => setMessage({ ok: false, text })}
        />
      ))}

      {confirmed.length > 0 && (
        <>
          <h3>Zugeordnet</h3>
          <div className="list">
            {confirmed.map((n) => (
              <div key={n.id} className="list-item" data-testid="delivery-confirmed">
                <div>
                  <div className="list-item-name">
                    {n.supplier?.name ?? 'Lieferant unbekannt'}
                    {n.noteNumber && <span className="list-item-meta"> · Nr. {n.noteNumber}</span>}
                  </div>
                  <div className="list-item-meta">
                    {n.noteDate && `${day(n.noteDate)} · `}
                    {n.project ? (
                      <Link to={`/projekte/${n.project.id}`}>
                        {n.project.number ? `${n.project.number} · ` : ''}
                        {n.project.title}
                      </Link>
                    ) : (
                      'ohne Projekt'
                    )}
                    {n.incomingInvoiceId ? ' · abgerechnet' : ' · noch ohne Rechnung'}
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
    </div>
  );
}

function NoteCard({
  note: n,
  suppliers,
  projects,
  onSaved,
  onError,
}: {
  note: DeliveryNote;
  suppliers: Option[];
  projects: Option[];
  onSaved: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [form, setForm] = useState({
    supplierId: n.supplier?.id ?? '',
    projectId: n.project?.id ?? '',
    noteNumber: n.noteNumber ?? '',
    noteDate: n.noteDate ?? '',
  });
  const reading = n.document.ocrStatus === 'queued' || n.document.ocrStatus === 'running';

  const confirm = async () => {
    try {
      await api.put(`/delivery-notes/${n.id}`, {
        supplierId: form.supplierId || null,
        projectId: form.projectId || null,
        noteNumber: form.noteNumber || null,
        noteDate: form.noteDate || null,
      });
      onSaved(`Lieferschein ${form.noteNumber || n.document.fileName} zugeordnet.`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
    }
  };

  return (
    <div className="card" style={{ marginBottom: 12 }} data-testid="delivery-open">
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <strong>{n.document.fileName}</strong>
        <span className="list-item-meta">
          hochgeladen {day(n.document.createdAt)}
          {reading && ' · Text wird erkannt …'}
          {n.document.ocrStatus === 'failed' && ' · Text nicht lesbar – bitte von Hand zuordnen'}
        </span>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => void api.openFile(`/documents/${n.document.id}/download`)}
        >
          Ansehen
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="field" style={{ flex: '1 1 220px' }}>
          <span>Lieferant{n.hints?.supplier && ` (erkannt: ${n.hints.supplier})`}</span>
          <select
            value={form.supplierId}
            onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
            data-testid="delivery-supplier"
          >
            <option value="">– unbekannt –</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: '1 1 260px' }}>
          <span>Projekt{n.hints?.project && ` (erkannt: ${n.hints.project})`}</span>
          <select
            value={form.projectId}
            onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            data-testid="delivery-project"
          >
            <option value="">– kein Projekt (Lager/Allgemein) –</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: '0 1 160px' }}>
          <span>Lieferschein-Nr.</span>
          <input
            value={form.noteNumber}
            onChange={(e) => setForm({ ...form, noteNumber: e.target.value })}
            data-testid="delivery-number"
          />
        </label>
        <label className="field" style={{ flex: '0 1 160px' }}>
          <span>Datum</span>
          <input
            type="date"
            value={form.noteDate}
            onChange={(e) => setForm({ ...form, noteDate: e.target.value })}
          />
        </label>
      </div>
      <button className="btn btn-primary" onClick={() => void confirm()} data-testid="delivery-confirm">
        Bestätigen
      </button>
    </div>
  );
}
