import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { resetAiTasks } from '../ai/tasks';

type Kind = 'openai_compatible' | 'anthropic' | 'agent';

interface AiProvider {
  id: string;
  name: string;
  kind: Kind;
  baseUrl: string;
  model: string | null;
  enabled: boolean;
  isDefault: boolean;
  hasApiKey: boolean;
  timeoutSeconds: number;
  maxTokens: number;
  systemPrompt: string | null;
  capabilities: Capability[];
}

type Capability = 'text' | 'vision' | 'image';

interface AiTask {
  key: string;
  label: string;
  description: string;
  needs: Capability;
  providerId: string | null;
  model: string | null;
}

const CAPABILITY_LABELS: Record<Capability, string> = {
  text: 'Text',
  vision: 'Bilder verstehen',
  image: 'Bilder/Zeichnungen erzeugen',
};

const KIND_LABELS: Record<Kind, string> = {
  openai_compatible: 'OpenAI-kompatibel',
  anthropic: 'Anthropic (Claude)',
  agent: 'Eigener Agent',
};

// Vorlagen: füllen Art und Adresse vor – alles bleibt änderbar
const PRESETS: { label: string; kind: Kind; name: string; baseUrl: string; model: string }[] = [
  {
    label: 'Ollama (selbst gehostet)',
    kind: 'openai_compatible',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
  },
  {
    label: 'LM Studio (selbst gehostet)',
    kind: 'openai_compatible',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
  },
  {
    label: 'vLLM / LocalAI (selbst gehostet)',
    kind: 'openai_compatible',
    name: 'Eigenes Modell',
    baseUrl: 'http://localhost:8000/v1',
    model: '',
  },
  {
    label: 'OpenRouter',
    kind: 'openai_compatible',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
  },
  {
    label: 'OpenAI',
    kind: 'openai_compatible',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
  },
  { label: 'Anthropic', kind: 'anthropic', name: 'Claude', baseUrl: 'https://api.anthropic.com', model: '' },
  { label: 'Eigener Agent (HTTP)', kind: 'agent', name: 'Eigener Agent', baseUrl: 'http://', model: '' },
];

const EMPTY = {
  name: '',
  kind: 'openai_compatible' as Kind,
  baseUrl: '',
  model: '',
  apiKey: '',
  timeoutSeconds: '60',
  maxTokens: '1024',
  systemPrompt: '',
  isDefault: false,
  capabilities: ['text'] as Capability[],
};
type Form = typeof EMPTY;

// KI-Anbieter der Firma: eigene APIs, selbst gehostete Modelle und eigene
// Agenten. Schlüssel werden verschlüsselt gespeichert und nie angezeigt.
export function AiProvidersSection() {
  const { hasPermission } = useAuth();
  const [providers, setProviders] = useState<AiProvider[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [tasks, setTasks] = useState<AiTask[]>([]);

  const load = useCallback(() => {
    resetAiTasks();
    api
      .get<AiProvider[]>('/ai/providers')
      .then(setProviders)
      .catch(() => setMessage({ ok: false, text: 'KI-Anbieter konnten nicht geladen werden.' }));
    api
      .get<{ tasks: AiTask[] }>('/ai/tasks')
      .then((r) => setTasks(r.tasks))
      .catch(() => setTasks([]));
  }, []);
  useEffect(load, [load]);

  const act = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (done) setMessage({ ok: true, text: done });
      load();
      return true;
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (p: AiProvider) => {
    setEditing(p.id);
    setForm({
      name: p.name,
      kind: p.kind,
      baseUrl: p.baseUrl,
      model: p.model ?? '',
      apiKey: '',
      timeoutSeconds: String(p.timeoutSeconds),
      maxTokens: String(p.maxTokens),
      systemPrompt: p.systemPrompt ?? '',
      isDefault: p.isDefault,
      capabilities: p.capabilities,
    });
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const body = {
      name: form.name,
      kind: form.kind,
      baseUrl: form.baseUrl,
      model: form.model,
      ...(form.apiKey.trim() ? { apiKey: form.apiKey } : {}),
      timeoutSeconds: Number(form.timeoutSeconds),
      maxTokens: Number(form.maxTokens),
      systemPrompt: form.systemPrompt,
      isDefault: form.isDefault,
      capabilities: form.capabilities,
    };
    const ok = await act(
      () =>
        editing === 'new' ? api.post('/ai/providers', body) : api.patch(`/ai/providers/${editing}`, body),
      'KI-Anbieter gespeichert.',
    );
    if (ok) setEditing(null);
  };

  const test = async (p: AiProvider) => {
    setTests((t) => ({ ...t, [p.id]: 'Teste …' }));
    try {
      const r = await api.post<{ ok: boolean; text?: string; error?: string; durationMs: number }>(
        `/ai/providers/${p.id}/test`,
      );
      const seconds = (r.durationMs / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 });
      setTests((t) => ({ ...t, [p.id]: r.ok ? `✓ Antwort „${r.text}“ nach ${seconds} s` : `✗ ${r.error}` }));
    } catch (err) {
      setTests((t) => ({
        ...t,
        [p.id]: `✗ ${err instanceof ApiError ? err.message : 'Test fehlgeschlagen.'}`,
      }));
    }
  };

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    setAnswer('Denkt nach …');
    try {
      const r = await api.post<{ text: string; providerName: string }>('/ai/gateway/complete', {
        prompt: question,
        task: 'frage',
      });
      setAnswer(`${r.providerName}: ${r.text}`);
    } catch (err) {
      setAnswer(err instanceof ApiError ? err.message : 'Keine Antwort.');
    }
  };

  const field = (key: keyof Form, label: string, props: Record<string, unknown> = {}) => (
    <label className="field">
      <span>{label}</span>
      <input
        value={String(form[key])}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        data-testid={`ai-${key}`}
        {...props}
      />
    </label>
  );

  return (
    <section className="settings-section" data-testid="ai-section">
      <h3>KI-Anbieter</h3>
      <p>
        Bewusst offen: jede OpenAI-kompatible API (auch selbst gehostet, z.B. Ollama oder LM Studio im eigenen
        Netz), Anthropic oder ein eigener Agent über HTTP. Die KI bekommt nur Daten, die der fragende Nutzer
        selbst sehen darf; jeder Aufruf steht im Protokoll. Schlüssel werden verschlüsselt gespeichert.
      </p>
      {message && (
        <p className={message.ok ? 'list-item-meta' : 'field-error'} data-testid="ai-message">
          {message.text}
        </p>
      )}
      {providers === null && !message && <p>Lädt …</p>}
      {providers?.length === 0 && <p className="list-item-meta">Noch kein Anbieter eingerichtet.</p>}
      {providers?.map((p) => (
        <div key={p.id} className="list-item" data-testid="ai-provider">
          <div>
            <div className="list-item-name">
              {p.name}
              {p.isDefault && <span className="status-badge status-done"> Standard</span>}
              {!p.enabled && <span className="status-badge status-cancelled"> aus</span>}
            </div>
            <div className="list-item-meta">
              {KIND_LABELS[p.kind]} · {p.baseUrl}
              {p.model ? ` · ${p.model}` : ''} · {p.hasApiKey ? 'Schlüssel hinterlegt' : 'ohne Schlüssel'}
            </div>
            <div className="list-item-meta">
              Kann: {p.capabilities.map((c) => CAPABILITY_LABELS[c]).join(', ')}
            </div>
            {tests[p.id] && (
              <div className="list-item-meta" data-testid="ai-test-result">
                {tests[p.id]}
              </div>
            )}
          </div>
          <div className="btn-row">
            <button className="btn btn-sm" onClick={() => test(p)} disabled={busy} data-testid="ai-test">
              Testen
            </button>
            <button className="btn btn-sm" onClick={() => startEdit(p)} disabled={busy}>
              Bearbeiten
            </button>
            {!p.isDefault && (
              <button
                className="btn btn-sm"
                onClick={() =>
                  act(() => api.patch(`/ai/providers/${p.id}`, { isDefault: true, enabled: true }))
                }
                disabled={busy}
              >
                Als Standard
              </button>
            )}
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => act(() => api.patch(`/ai/providers/${p.id}`, { enabled: !p.enabled }))}
              disabled={busy}
            >
              {p.enabled ? 'Ausschalten' : 'Einschalten'}
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() =>
                window.confirm(`„${p.name}“ löschen?`) && act(() => api.delete(`/ai/providers/${p.id}`))
              }
              disabled={busy}
            >
              Löschen
            </button>
          </div>
        </div>
      ))}

      {editing === null ? (
        <div className="btn-row" style={{ marginTop: 12 }}>
          <select
            defaultValue=""
            onChange={(e) => {
              const preset = PRESETS[Number(e.target.value)];
              if (!preset) return;
              setForm({ ...EMPTY, ...preset, isDefault: !providers?.length });
              setEditing('new');
              e.target.value = '';
            }}
            data-testid="ai-add"
          >
            <option value="" disabled>
              Anbieter hinzufügen …
            </option>
            {PRESETS.map((preset, i) => (
              <option key={preset.label} value={i}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <form onSubmit={save} className="login-form" style={{ marginTop: 12 }} data-testid="ai-form">
          {field('name', 'Name')}
          <label className="field">
            <span>Art</span>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
              {Object.entries(KIND_LABELS).map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {field(
            'baseUrl',
            form.kind === 'agent' ? 'Adresse des Agenten' : 'Adresse (bis einschließlich /v1)',
          )}
          {field('model', form.kind === 'agent' ? 'Modell (optional, geht an den Agenten)' : 'Modell')}
          {field(
            'apiKey',
            editing === 'new' ? 'API-Schlüssel (optional)' : 'Neuer API-Schlüssel (leer = unverändert)',
            {
              type: 'password',
              autoComplete: 'off',
            },
          )}
          {field('timeoutSeconds', 'Zeitlimit in Sekunden', { inputMode: 'numeric' })}
          {field('maxTokens', 'Höchstlänge der Antwort (Tokens)', { inputMode: 'numeric' })}
          {field('systemPrompt', 'Hinweis an das Modell (optional)')}
          <fieldset className="field" style={{ border: 0, padding: 0 }}>
            <span>Kann</span>
            <div className="btn-row">
              {(Object.keys(CAPABILITY_LABELS) as Capability[]).map((c) => (
                <label key={c} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={form.capabilities.includes(c)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        capabilities: e.target.checked
                          ? [...form.capabilities, c]
                          : form.capabilities.filter((x) => x !== c),
                      })
                    }
                    data-testid={`ai-cap-${c}`}
                  />
                  {CAPABILITY_LABELS[c]}
                </label>
              ))}
            </div>
          </fieldset>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              data-testid="ai-isDefault"
            />
            Standard-Anbieter der Firma
          </label>
          <div className="btn-row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !form.capabilities.length}
              data-testid="ai-save"
            >
              Speichern
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {!!providers?.length && tasks.length > 0 && (
        <div style={{ marginTop: 16 }} data-testid="ai-tasks">
          <h4>Aufgaben</h4>
          <p className="list-item-meta">
            Jede Aufgabe kann einen eigenen Anbieter und ein eigenes Modell bekommen, z.B. ein kleines
            schnelles Modell für Zusammenfassungen. Ohne Zuordnung übernimmt der Standard-Anbieter.
          </p>
          {tasks.map((t) => (
            <TaskRow
              // neu aufbauen, wenn die gespeicherte Zuordnung sich ändert
              key={`${t.key}:${t.providerId}:${t.model}`}
              task={t}
              providers={providers.filter((p) => p.capabilities.includes(t.needs))}
              busy={busy}
              onSave={(providerId, model) =>
                act(
                  () => api.put(`/ai/tasks/${t.key}`, { providerId, model }),
                  `Aufgabe „${t.label}“ gespeichert.`,
                )
              }
            />
          ))}
        </div>
      )}

      {hasPermission('ai.use') && providers?.some((p) => p.isDefault && p.enabled) && (
        <form onSubmit={ask} className="login-form" style={{ marginTop: 16 }}>
          <label className="field">
            <span>Frage an den Standard-Anbieter</span>
            <input value={question} onChange={(e) => setQuestion(e.target.value)} data-testid="ai-question" />
          </label>
          <button type="submit" className="btn" disabled={!question.trim()} data-testid="ai-ask">
            Fragen
          </button>
          {answer && (
            <p className="list-item-meta" data-testid="ai-answer" style={{ whiteSpace: 'pre-wrap' }}>
              {answer}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

function TaskRow({
  task,
  providers,
  busy,
  onSave,
}: {
  task: AiTask;
  providers: AiProvider[];
  busy: boolean;
  onSave: (providerId: string | null, model: string | null) => void;
}) {
  const [providerId, setProviderId] = useState(task.providerId ?? '');
  const [model, setModel] = useState(task.model ?? '');
  const changed = providerId !== (task.providerId ?? '') || model !== (task.model ?? '');
  return (
    <div className="list-item" data-testid={`ai-task-${task.key}`}>
      <div>
        <div className="list-item-name">{task.label}</div>
        <div className="list-item-meta">
          {task.description} · braucht: {CAPABILITY_LABELS[task.needs]}
        </div>
      </div>
      <div className="btn-row">
        <select
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          data-testid="ai-task-provider"
        >
          <option value="">Standard-Anbieter</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {providerId && (
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Modell (leer = wie Anbieter)"
            data-testid="ai-task-model"
          />
        )}
        <button
          className="btn btn-sm"
          disabled={busy || !changed}
          onClick={() => onSave(providerId || null, providerId ? model.trim() || null : null)}
          data-testid="ai-task-save"
        >
          Übernehmen
        </button>
      </div>
    </div>
  );
}
