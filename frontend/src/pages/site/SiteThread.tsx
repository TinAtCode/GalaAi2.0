import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import {
  discardSiteEntry,
  isNetworkError,
  queueSiteEntry,
  subscribeOffline,
  useOnline,
  useSiteOutbox,
} from '../../offline/sync';
import { compressPhoto } from './photo';

export interface SiteMessage {
  id: string;
  text: string | null;
  documentId: string | null;
  createdAt: string;
  author: { id: string; firstName: string; lastName: string };
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

// Foto aus einer Nachricht (mit Anmeldung geladen, daher als Blob)
function Photo({ documentId }: { documentId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let current = true;
    api
      .blob(`/site/photos/${documentId}`)
      .then((blob) => {
        if (!current) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId]);
  if (failed) return <div className="site-photo site-photo-missing">Foto nicht verfügbar</div>;
  if (!url) return <div className="site-photo site-photo-loading" aria-label="Foto lädt" />;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img className="site-photo" src={url} alt="Foto von der Baustelle" data-testid="site-photo" />
    </a>
  );
}

function PendingPhoto({ blob }: { blob: Blob }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img className="site-photo" src={url} alt="Foto wartet auf Übertragung" />;
}

// Nachrichten und Fotos eines Projekts zwischen Büro und Baustelle. Ohne Netz
// landet alles in der Warteschlange des Geräts und geht später raus.
export function SiteThread({ projectId, compact }: { projectId: string; compact?: boolean }) {
  const { user } = useAuth();
  const online = useOnline();
  const outbox = useSiteOutbox().filter((e) => e.projectId === projectId);
  const [messages, setMessages] = useState<SiteMessage[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api
      .get<{ messages: SiteMessage[] }>(`/site/projects/${projectId}/messages`)
      .then((res) => {
        setMessages(res.messages);
        setError(null);
        void api.post(`/site/projects/${projectId}/read`, {}).catch(() => undefined);
      })
      .catch((err) => {
        if (!isNetworkError(err))
          setError(err instanceof ApiError ? err.message : 'Nachrichten nicht verfügbar.');
      });
  }, [projectId]);

  // beim Öffnen, nach jeder Übertragung aus der Warteschlange und alle 30 s
  useEffect(() => {
    load();
    const unsubscribe = subscribeOffline(load);
    const timer = window.setInterval(() => navigator.onLine && load(), 30_000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!compact) bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages?.length, outbox.length, compact]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    setText('');
    setBusy(true);
    try {
      await queueSiteEntry({ projectId, kind: 'text', text: message });
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (!files.length) return;
    // der Text im Feld ist die Bildunterschrift; was danach getippt wird, bleibt stehen
    const caption = text.trim();
    setBusy(true);
    try {
      for (const file of files) {
        const { blob, fileName } = await compressPhoto(file);
        await queueSiteEntry({ projectId, kind: 'photo', photo: blob, fileName, text: caption || undefined });
      }
      if (caption) setText((current) => (current.trim() === caption ? '' : current));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`site-thread${compact ? ' is-compact' : ''}`} data-testid="site-thread">
      {error && <p className="field-error">{error}</p>}
      {messages?.length === 0 && outbox.length === 0 && (
        <p className="list-item-meta">
          Noch keine Nachrichten. Fotos und Hinweise von der Baustelle landen hier.
        </p>
      )}
      <ul className="site-messages">
        {messages?.map((m) => (
          <li
            key={m.id}
            className={`site-message${m.author.id === user?.id ? ' is-mine' : ''}`}
            data-testid="site-message"
          >
            <div className="site-message-meta">
              {m.author.firstName} {m.author.lastName} · {when(m.createdAt)}
            </div>
            {m.documentId && <Photo documentId={m.documentId} />}
            {m.text && <div className="site-message-text">{m.text}</div>}
          </li>
        ))}
        {outbox.map((entry) => (
          <li key={entry.clientId} className="site-message is-mine is-pending" data-testid="site-pending">
            <div className="site-message-meta">
              {entry.error
                ? `Nicht übertragen: ${entry.error}`
                : online
                  ? 'wird übertragen …'
                  : 'wartet auf Netz'}
            </div>
            {entry.photo && <PendingPhoto blob={entry.photo} />}
            {entry.text && <div className="site-message-text">{entry.text}</div>}
            {entry.error && (
              <button className="btn btn-sm btn-ghost" onClick={() => discardSiteEntry(entry.clientId)}>
                Verwerfen
              </button>
            )}
          </li>
        ))}
      </ul>
      <div ref={bottom} />
      <form className="site-composer" onSubmit={send}>
        <label className="btn site-camera" aria-label="Foto aufnehmen" title="Foto aufnehmen">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
            <circle cx="12" cy="13.5" r="3.5" />
          </svg>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={takePhoto}
            disabled={busy}
            style={{ display: 'none' }}
            data-testid="site-photo-input"
          />
        </label>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nachricht (oder Text zum Foto)"
          aria-label="Nachricht"
          maxLength={4000}
          data-testid="site-text"
        />
        <button type="submit" className="btn btn-primary" disabled={!text.trim()} data-testid="site-send">
          Senden
        </button>
      </form>
    </div>
  );
}
