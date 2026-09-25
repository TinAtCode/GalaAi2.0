import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';

interface Item {
  id: string;
  text: string;
  position: number;
  doneAt: string | null;
  doneBy: string | null;
  addedBy: string | null;
  addedOnSite: boolean;
}

interface Comment {
  id: string;
  itemId: string | null;
  user: string | null;
  text: string;
  createdAt: string;
}

interface Checklist {
  id: string;
  title: string;
  template: { id: string; title: string } | null;
  createdBy: string | null;
  items: Item[];
  comments: Comment[];
  progress: { done: number; total: number };
}

interface Template {
  id: string;
  title: string;
  status: 'proposed' | 'approved' | 'archived';
  items: string[];
}

const time = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

// Checklisten am Projekt: der Einsatzplaner legt Listen an (leer oder aus
// einer freigegebenen Vorlage), auf der Baustelle wird abgehakt, ergänzt und
// kommentiert. Eine Liste lässt sich als Vorlage vorschlagen.
export function ChecklistsSection({ projectId, compact }: { projectId: string; compact?: boolean }) {
  const [checklists, setChecklists] = useState<Checklist[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState({ title: '', templateId: '' });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(
    () =>
      api
        .get<{ checklists: Checklist[]; canManage: boolean }>(`/projects/${projectId}/checklists`)
        .then((r) => {
          setChecklists(r.checklists);
          setCanManage(r.canManage);
        })
        .catch(() => setMessage({ ok: false, text: 'Checklisten konnten nicht geladen werden.' })),
    [projectId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!canManage) return;
    api
      .get<{ templates: Template[] }>('/checklist-templates')
      .then((r) => setTemplates(r.templates.filter((t) => t.status === 'approved')))
      .catch(() => setTemplates([]));
  }, [canManage]);

  const run = async (action: () => Promise<unknown>, ok?: string) => {
    try {
      await action();
      setMessage(ok ? { ok: true, text: ok } : null);
      await load();
      return true;
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.' });
      return false;
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await run(
      () =>
        api.post(`/projects/${projectId}/checklists`, {
          title: form.title,
          templateId: form.templateId || undefined,
        }),
      'Checkliste angelegt.',
    );
    if (ok) setForm({ title: '', templateId: '' });
  };

  return (
    <div data-testid="checklists">
      <h3 style={{ marginTop: 0 }}>Checklisten</h3>
      {message && (
        <p className={message.ok ? 'notice' : 'field-error'} data-testid="checklist-message">
          {message.text}
        </p>
      )}
      {checklists === null && !message && <p>Lädt …</p>}
      {checklists?.length === 0 && (
        <p className="list-item-meta">
          Noch keine Checkliste.{!canManage && ' Listen legt der Einsatzplaner an.'}
        </p>
      )}
      {checklists?.map((c) => (
        <ChecklistCard key={c.id} checklist={c} canManage={canManage} compact={compact} run={run} />
      ))}
      {canManage && (
        <form className="toolbar" onSubmit={create} style={{ marginTop: 12 }} data-testid="checklist-create">
          <label className="inline-field">
            <span>Neue Liste</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="z.B. Pflaster Einfahrt"
              required
              minLength={2}
              data-testid="checklist-title"
            />
          </label>
          <label className="inline-field">
            <span>Vorlage</span>
            <select
              value={form.templateId}
              onChange={(e) =>
                setForm({
                  templateId: e.target.value,
                  title: form.title || templates.find((t) => t.id === e.target.value)?.title || '',
                })
              }
              data-testid="checklist-template"
            >
              <option value="">– leer –</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ({t.items.length})
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-primary" data-testid="checklist-add">
            Anlegen
          </button>
        </form>
      )}
    </div>
  );
}

function ChecklistCard({
  checklist: c,
  canManage,
  compact,
  run,
}: {
  checklist: Checklist;
  canManage: boolean;
  compact?: boolean;
  run: (action: () => Promise<unknown>, ok?: string) => Promise<boolean>;
}) {
  const [newItem, setNewItem] = useState('');
  const [commentFor, setCommentFor] = useState<string | null>(null);
  // Haken sofort zeigen, bis die Liste neu geladen ist
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [comment, setComment] = useState('');
  const general = c.comments.filter((m) => !m.itemId);

  const addItem = async (event: FormEvent) => {
    event.preventDefault();
    if (await run(() => api.post(`/checklists/${c.id}/items`, { text: newItem }))) setNewItem('');
  };
  const sendComment = async (event: FormEvent) => {
    event.preventDefault();
    const itemId = commentFor === 'list' ? undefined : (commentFor ?? undefined);
    if (await run(() => api.post(`/checklists/${c.id}/comments`, { text: comment, itemId }))) {
      setComment('');
      setCommentFor(null);
    }
  };
  const propose = () => {
    const title = window.prompt(
      canManage ? 'Name der neuen Vorlage' : 'Name der Vorlage (der Einsatzplaner prüft den Vorschlag)',
      c.title,
    );
    if (title)
      void run(
        () => api.post(`/checklists/${c.id}/propose-template`, { title }),
        canManage ? 'Vorlage gespeichert.' : 'Vorlage vorgeschlagen – der Einsatzplaner prüft sie.',
      );
  };

  const commentForm = (
    <form className="btn-row" onSubmit={sendComment} style={{ marginTop: 4 }}>
      <input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Kommentar"
        required
        autoFocus
        style={{ flex: 1 }}
        data-testid="checklist-comment-text"
      />
      <button type="submit" className="btn btn-sm" data-testid="checklist-comment-send">
        Senden
      </button>
    </form>
  );

  return (
    <details open={!compact || c.progress.done < c.progress.total} className="card" data-testid="checklist">
      <summary style={{ cursor: 'pointer' }}>
        <strong>{c.title}</strong>{' '}
        <span className="list-item-meta" data-testid="checklist-progress">
          {c.progress.done}/{c.progress.total} erledigt
          {c.template && ` · Vorlage ${c.template.title}`}
        </span>
      </summary>
      <div style={{ marginTop: 8 }}>
        {c.items.map((i) => {
          const itemComments = c.comments.filter((m) => m.itemId === i.id);
          return (
            <div key={i.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} data-testid="checklist-item">
                <input
                  type="checkbox"
                  checked={pending[i.id] ?? !!i.doneAt}
                  onChange={(e) => {
                    const done = e.target.checked;
                    setPending((p) => ({ ...p, [i.id]: done }));
                    void run(() => api.put(`/checklists/items/${i.id}`, { done })).finally(() =>
                      setPending((p) => {
                        const rest = { ...p };
                        delete rest[i.id];
                        return rest;
                      }),
                    );
                  }}
                  aria-label={i.text}
                  data-testid="checklist-check"
                />
                <span style={{ flex: 1, textDecoration: i.doneAt ? 'line-through' : undefined }}>
                  {i.text}
                  {i.addedOnSite && (
                    <span className="status-badge status-open" style={{ marginLeft: 6 }}>
                      ergänzt von {i.addedBy}
                    </span>
                  )}
                  {i.doneAt && (
                    <span className="list-item-meta">
                      {' '}
                      · {i.doneBy}, {time(i.doneAt)}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setCommentFor(commentFor === i.id ? null : i.id)}
                  data-testid="checklist-comment"
                >
                  Kommentar{itemComments.length ? ` (${itemComments.length})` : ''}
                </button>
                {canManage && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    aria-label="Punkt löschen"
                    onClick={() => void run(() => api.delete(`/checklists/items/${i.id}`))}
                  >
                    ✕
                  </button>
                )}
              </div>
              {itemComments.map((m) => (
                <div
                  key={m.id}
                  className="list-item-meta"
                  style={{ marginLeft: 26 }}
                  data-testid="checklist-comment-row"
                >
                  {m.user}, {time(m.createdAt)}: {m.text}
                </div>
              ))}
              {commentFor === i.id && <div style={{ marginLeft: 26 }}>{commentForm}</div>}
            </div>
          );
        })}
        <form className="btn-row" onSubmit={addItem} style={{ marginTop: 8 }}>
          <input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            placeholder="Punkt ergänzen"
            required
            style={{ flex: 1 }}
            data-testid="checklist-new-item"
          />
          <button type="submit" className="btn btn-sm" data-testid="checklist-new-item-add">
            Ergänzen
          </button>
        </form>
        {general.map((m) => (
          <div key={m.id} className="list-item-meta" style={{ marginTop: 4 }}>
            {m.user}, {time(m.createdAt)}: {m.text}
          </div>
        ))}
        {commentFor === 'list' && commentForm}
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCommentFor('list')}>
            Kommentar zur Liste
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={propose}
            data-testid="checklist-propose"
          >
            {canManage ? 'Als Vorlage speichern' : 'Als Vorlage vorschlagen'}
          </button>
          {canManage && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                if (window.confirm(`Checkliste „${c.title}“ löschen?`))
                  void run(() => api.delete(`/checklists/${c.id}`), 'Checkliste gelöscht.');
              }}
            >
              Liste löschen
            </button>
          )}
        </div>
      </div>
    </details>
  );
}
