import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';

type OcrStatus = 'queued' | 'running' | 'done' | 'failed';

interface ProjectDocument {
  id: string;
  fileName: string;
  documentType: string;
  createdAt: string;
  ocrStatus: OcrStatus | null;
  ocrSnippet: string | null;
}

// Auswahl beim Hochladen; weitere Typen (aus der Texterkennung) nur als Anzeige
const UPLOAD_TYPES: { value: string; label: string }[] = [
  { value: 'site_document', label: 'Baustelle / Foto' },
  { value: 'delivery_note', label: 'Lieferschein' },
  { value: 'floor_plan', label: 'Plan / Grundriss' },
  { value: 'survey', label: 'Aufmaß' },
  { value: 'customer_document', label: 'Vom Kunden' },
  { value: 'invoice', label: 'Eingangsrechnung' },
  { value: 'other', label: 'Sonstiges' },
];
const TYPE_LABELS: Record<string, string> = {
  ...Object.fromEntries(UPLOAD_TYPES.map((t) => [t.value, t.label])),
  quote: 'Angebot',
  order_confirmation: 'Auftragsbestätigung',
  price_list: 'Preisliste',
  catalog: 'Katalog',
  credit_note: 'Gutschrift',
  reminder: 'Mahnung',
  purchase_order: 'Bestellung',
};

const OCR_LABELS: Record<OcrStatus, string> = {
  queued: 'Text wird erkannt …',
  running: 'Text wird erkannt …',
  done: 'Text erkannt',
  failed: 'Texterkennung fehlgeschlagen',
};

// Texterkennung nur für PDF und Bilder (wie im Backend)
const ocrPossible = (file: File) => file.type === 'application/pdf' || file.type.startsWith('image/');

const day = (iso: string) => new Date(iso).toLocaleDateString('de-DE');

// Dokumente am Projekt: Fotos, Lieferscheine, Pläne hochladen, optional mit
// Texterkennung; Suche in Dateiname und erkanntem Text.
export function DocumentsSection({ projectId, canDelete }: { projectId: string; canDelete: boolean }) {
  const [documents, setDocuments] = useState<ProjectDocument[] | null>(null);
  const [documentType, setDocumentType] = useState('site_document');
  const [ocr, setOcr] = useState(true);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latestLoad = useRef(0);

  const load = useCallback(() => {
    const requestId = ++latestLoad.current;
    const q = search ? `?q=${encodeURIComponent(search)}` : '';
    return api
      .get<ProjectDocument[]>(`/documents/by-project/${projectId}${q}`)
      .then((list) => {
        if (requestId === latestLoad.current) setDocuments(list);
      })
      .catch((err) => {
        if (requestId === latestLoad.current)
          setError(err instanceof ApiError ? err.message : 'Dokumente konnten nicht geladen werden.');
      });
  }, [projectId, search]);

  useEffect(() => {
    load();
  }, [load]);

  // Solange Text erkannt wird, alle 2 Sekunden neu laden
  const pending = documents?.some((d) => d.ocrStatus === 'queued' || d.ocrStatus === 'running');
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(load, 2000);
    return () => clearTimeout(timer);
  }, [pending, documents, load]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
    } finally {
      // auch nach einem Fehler: bei mehreren Dateien sind einige evtl. schon hochgeladen
      await load();
      setBusy(false);
    }
  };

  const uploadFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length === 0) return;
    run(async () => {
      for (const file of files) {
        const params = new URLSearchParams({ projectId, documentType });
        if (ocr && ocrPossible(file)) params.set('ocr', '1');
        await api.upload(`/documents/upload?${params}`, file);
      }
    });
  };

  const remove = (doc: ProjectDocument) => {
    if (!window.confirm(`„${doc.fileName}“ löschen?`)) return;
    run(() => api.delete(`/documents/${doc.id}`));
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setSearch(query.trim());
  };

  return (
    <section data-testid="documents-section">
      <h3 style={{ marginTop: 28, marginBottom: 8 }}>Dokumente</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
        <label className="field">
          <span>Art</span>
          <select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            data-testid="document-type"
          >
            {UPLOAD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="btn btn-primary" style={{ display: 'inline-block' }}>
          Dateien hochladen
          <input
            type="file"
            multiple
            onChange={uploadFiles}
            disabled={busy}
            style={{ display: 'none' }}
            data-testid="document-upload"
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem' }}>
          <input
            type="checkbox"
            checked={ocr}
            onChange={(e) => setOcr(e.target.checked)}
            data-testid="document-ocr"
          />
          Text erkennen (PDF und Bilder, für die Suche)
        </label>
      </div>
      <form onSubmit={submitSearch} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="In Dokumenten suchen"
          maxLength={100}
          data-testid="document-search"
        />
        <button type="submit" className="btn">
          Suchen
        </button>
        {search && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setQuery('');
              setSearch('');
            }}
          >
            Alle zeigen
          </button>
        )}
      </form>
      {error && <p className="field-error">{error}</p>}
      {documents === null && !error && <p>Lädt …</p>}
      {documents?.length === 0 && (
        <p className="list-item-meta">
          {search ? `Nichts gefunden für „${search}“.` : 'Noch keine Dokumente.'}
        </p>
      )}
      {documents?.map((doc) => (
        <div key={doc.id} className="list-item" data-testid="document-item" data-document-id={doc.id}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="list-item-name">{doc.fileName}</div>
            <div className="list-item-meta">
              {TYPE_LABELS[doc.documentType] ?? doc.documentType} · {day(doc.createdAt)}
              {doc.ocrStatus && <span data-testid="document-ocr-status"> · {OCR_LABELS[doc.ocrStatus]}</span>}
            </div>
            {doc.ocrSnippet && (
              <div className="list-item-meta" style={{ fontStyle: 'italic' }} data-testid="document-snippet">
                {doc.ocrSnippet}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn"
              disabled={busy}
              onClick={() => run(() => api.downloadFile(`/documents/${doc.id}/download`, doc.fileName))}
              data-testid="document-download"
            >
              Herunterladen
            </button>
            {canDelete && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => remove(doc)}
                data-testid="document-delete"
              >
                Löschen
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
