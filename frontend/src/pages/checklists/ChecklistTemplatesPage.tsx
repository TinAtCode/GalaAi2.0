import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';

interface Template {
  id: string;
  title: string;
  description: string | null;
  items: string[];
  status: 'proposed' | 'approved' | 'archived';
  proposedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

// Checklisten-Vorlagen: der Einsatzplaner legt Vorlagen an, prüft Vorschläge
// von der Baustelle (freigeben, anpassen oder ablehnen) und archiviert alte.
export function ChecklistTemplatesPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({ title: '', items: '' });

  const load = useCallback(() => {
    api
      .get<{ templates: Template[]; canManage: boolean }>('/checklist-templates')
      .then((r) => {
        setTemplates(r.templates);
        setCanManage(r.canManage);
      })
      .catch(() => setMessage({ ok: false, text: 'Vorlagen konnten nicht geladen werden.' }));
  }, []);
  useEffect(load, [load]);

  const run = async (action: () => Promise<unknown>, ok: string) => {
    try {
      await action();
      setMessage({ ok: true, text: ok });
      load();
      return true;
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.' });
      return false;
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (
      await run(
        () => api.post('/checklist-templates', { title: form.title, items: lines(form.items) }),
        'Vorlage angelegt.',
      )
    )
      setForm({ title: '', items: '' });
  };

  const proposed = templates?.filter((t) => t.status === 'proposed') ?? [];
  const approved = templates?.filter((t) => t.status === 'approved') ?? [];
  const archived = templates?.filter((t) => t.status === 'archived') ?? [];

  return (
    <div data-testid="checklist-templates">
      <header className="page-header">
        <h2>Checklisten-Vorlagen</h2>
      </header>
      <p className="list-item-meta">
        Vorlagen für wiederkehrende Arbeiten. Listen am Projekt legt der Einsatzplaner aus einer Vorlage an;
        auf der Baustelle werden sie abgehakt, ergänzt und kommentiert. Eine bewährte Liste kann jeder als
        Vorlage vorschlagen
        {canManage ? ' – Vorschläge prüfst du hier.' : '; der Einsatzplaner prüft den Vorschlag.'}
      </p>
      {message && (
        <p className={message.ok ? 'notice' : 'field-error'} data-testid="templates-message">
          {message.text}
        </p>
      )}
      {templates === null && !message && <p>Lädt …</p>}

      {proposed.length > 0 && (
        <>
          <h3>{canManage ? 'Zur Prüfung' : 'Meine Vorschläge'}</h3>
          {proposed.map((t) => (
            <TemplateCard key={t.id} template={t} canManage={canManage} run={run} />
          ))}
        </>
      )}

      <h3>Freigegeben</h3>
      {templates && approved.length === 0 && <p className="list-item-meta">Noch keine Vorlagen.</p>}
      {approved.map((t) => (
        <TemplateCard key={t.id} template={t} canManage={canManage} run={run} />
      ))}

      {canManage && (
        <form
          className="card login-form"
          onSubmit={create}
          style={{ marginTop: 16 }}
          data-testid="template-form"
        >
          <strong>Neue Vorlage</strong>
          <label className="field">
            <span>Titel</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              minLength={2}
              data-testid="template-title"
            />
          </label>
          <label className="field">
            <span>Punkte (einer pro Zeile)</span>
            <textarea
              value={form.items}
              onChange={(e) => setForm({ ...form, items: e.target.value })}
              rows={6}
              required
              data-testid="template-items"
            />
          </label>
          <button type="submit" className="btn btn-primary" data-testid="template-save">
            Anlegen
          </button>
        </form>
      )}

      {archived.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary>Archiv und abgelehnte Vorschläge ({archived.length})</summary>
          {archived.map((t) => (
            <TemplateCard key={t.id} template={t} canManage={canManage} run={run} />
          ))}
        </details>
      )}
    </div>
  );
}

function TemplateCard({
  template: t,
  canManage,
  run,
}: {
  template: Template;
  canManage: boolean;
  run: (action: () => Promise<unknown>, ok: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [items, setItems] = useState(t.items.join('\n'));
  const [note, setNote] = useState('');

  const review = (approve: boolean) =>
    run(
      () => api.post(`/checklist-templates/${t.id}/review`, { approve, note, title, items: lines(items) }),
      approve ? `„${title}“ freigegeben.` : `Vorschlag „${t.title}“ abgelehnt.`,
    );
  const save = (status?: 'approved' | 'archived') =>
    run(
      () => api.put(`/checklist-templates/${t.id}`, { title, items: lines(items), status }),
      status === 'archived'
        ? 'Vorlage archiviert.'
        : status === 'approved'
          ? 'Vorlage wieder aktiv.'
          : 'Gespeichert.',
    ).then((ok) => ok && setEditing(false));

  const reviewing = canManage && t.status === 'proposed';
  return (
    <div className="card" style={{ marginBottom: 12 }} data-testid="template-card">
      <div className="toolbar" style={{ marginBottom: 4 }}>
        <strong>{t.title}</strong>
        <span className="list-item-meta">
          {t.items.length} Punkte
          {t.proposedBy && ` · vorgeschlagen von ${t.proposedBy}`}
          {t.reviewedBy && t.reviewedAt && ` · geprüft von ${t.reviewedBy}`}
          {t.reviewNote && ` · „${t.reviewNote}“`}
        </span>
      </div>
      {reviewing || editing ? (
        <div className="login-form">
          <label className="field">
            <span>Titel</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>Punkte (einer pro Zeile)</span>
            <textarea
              value={items}
              onChange={(e) => setItems(e.target.value)}
              rows={Math.min(12, t.items.length + 2)}
            />
          </label>
          {reviewing ? (
            <>
              <label className="field">
                <span>Notiz zur Prüfung</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} data-testid="template-note" />
              </label>
              <div className="btn-row">
                <button
                  className="btn btn-primary"
                  onClick={() => void review(true)}
                  data-testid="template-approve"
                >
                  Freigeben
                </button>
                <button className="btn" onClick={() => void review(false)} data-testid="template-reject">
                  Ablehnen
                </button>
              </div>
            </>
          ) : (
            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => void save()}>
                Speichern
              </button>
              <button className="btn btn-ghost" onClick={() => setEditing(false)}>
                Abbrechen
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <ol style={{ margin: '4px 0 8px 20px', padding: 0 }}>
            {t.items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ol>
          {canManage && t.status !== 'proposed' && (
            <div className="btn-row">
              <button className="btn btn-sm" onClick={() => setEditing(true)}>
                Bearbeiten
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => void save(t.status === 'archived' ? 'approved' : 'archived')}
              >
                {t.status === 'archived' ? 'Wieder aktivieren' : 'Archivieren'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
