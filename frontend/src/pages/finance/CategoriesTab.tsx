import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { Category, RuleField } from './shared';

const FIELDS: { value: RuleField; label: string }[] = [
  { value: 'any', label: 'Name oder Verwendungszweck' },
  { value: 'counterparty', label: 'Empfängername' },
  { value: 'remittance', label: 'Verwendungszweck' },
  { value: 'iban', label: 'IBAN (genau)' },
];
const fieldLabel = (field: RuleField) => FIELDS.find((f) => f.value === field)!.label;

// Ausgabenkategorien und ihre Stichwort-Regeln. Neue Abbuchungen bekommen
// zuerst die Kategorie, die ihr Empfänger zuletzt von Hand bekam, sonst die
// der ersten passenden Regel (neueste zuerst).
export function CategoriesTab() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [name, setName] = useState('');
  const [rule, setRule] = useState<Record<string, { pattern: string; field: RuleField }>>({});
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api
        .get<Category[]>('/finance/categories')
        .then(setCategories)
        .catch((err) =>
          setError(err instanceof ApiError ? err.message : 'Kategorien konnten nicht geladen werden.'),
        ),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
    } finally {
      await load();
      setBusy(false);
    }
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) return;
    run(async () => {
      await api.post('/finance/categories', { name: name.trim() });
      setName('');
    });
  };

  const addRule = (event: FormEvent, category: Category) => {
    event.preventDefault();
    const input = rule[category.id];
    if (!input?.pattern.trim()) return;
    run(async () => {
      const { assigned } = await api.post<{ assigned: number }>(`/finance/categories/${category.id}/rules`, {
        pattern: input.pattern.trim(),
        field: input.field,
      });
      setRule({ ...rule, [category.id]: { pattern: '', field: input.field } });
      return assigned ? `${assigned} offene Abbuchung${assigned === 1 ? '' : 'en'} zugeordnet.` : undefined;
    });
  };

  const rename = (event: FormEvent) => {
    event.preventDefault();
    if (!editing || editing.name.trim().length < 2) return;
    run(async () => {
      await api.patch(`/finance/categories/${editing.id}`, { name: editing.name.trim() });
      setEditing(null);
    });
  };

  const remove = (category: Category) => {
    const note = category.transactions
      ? ` ${category.transactions} Abbuchung${category.transactions === 1 ? ' verliert' : 'en verlieren'} die Kategorie.`
      : '';
    if (!window.confirm(`Kategorie „${category.name}“ löschen?${note}`)) return;
    run(async () => {
      await api.delete(`/finance/categories/${category.id}`);
    });
  };

  return (
    <section>
      <p className="list-item-meta">
        Neue Abbuchungen bekommen die Kategorie, die derselbe Empfänger zuletzt von Hand bekam – sonst die der
        ersten passenden Regel. Stichwörter werden ohne Groß-/Kleinschreibung gesucht.
      </p>
      {error && <p className="field-error">{error}</p>}
      {notice && <p className="list-item-meta">{notice}</p>}
      <form
        onSubmit={create}
        style={{ display: 'flex', gap: 8, alignItems: 'flex-end', margin: '8px 0 16px' }}
      >
        <label className="field" style={{ flex: '1 1 220px', maxWidth: 320 }}>
          <span>Neue Kategorie</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="z. B. Entsorgung"
            data-testid="category-name"
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || name.trim().length < 2}>
          Anlegen
        </button>
      </form>
      {categories === null && !error && <p>Lädt …</p>}
      {categories?.map((c) => {
        const input = rule[c.id] ?? { pattern: '', field: 'any' as RuleField };
        return (
          <div key={c.id} className="list-item" style={{ display: 'block' }} data-testid="category">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {editing?.id === c.id ? (
                <form onSubmit={rename} style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}>
                  <input
                    value={editing.name}
                    onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                    maxLength={40}
                    autoFocus
                    aria-label="Name der Kategorie"
                  />
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    Speichern
                  </button>
                  <button type="button" className="btn" onClick={() => setEditing(null)}>
                    Abbrechen
                  </button>
                </form>
              ) : (
                <>
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <span className="list-item-name">{c.name}</span>
                    <span className="list-item-meta">
                      {' '}
                      · {c.transactions} Abbuchung{c.transactions === 1 ? '' : 'en'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn" onClick={() => setEditing({ id: c.id, name: c.name })}>
                      Umbenennen
                    </button>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => remove(c)}
                      data-testid="category-delete"
                    >
                      Löschen
                    </button>
                  </div>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
              {c.rules.length === 0 && <span className="list-item-meta">Keine Regeln.</span>}
              {c.rules.map((r) => (
                <span
                  key={r.id}
                  className="status-badge"
                  title={fieldLabel(r.field)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  data-testid="category-rule"
                >
                  {r.field === 'iban' ? `IBAN ${r.pattern}` : r.pattern}
                  {r.field !== 'any' && r.field !== 'iban' && (
                    <span className="list-item-meta">({fieldLabel(r.field)})</span>
                  )}
                  <button
                    type="button"
                    aria-label={`Regel ${r.pattern} entfernen`}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.delete(`/finance/rules/${r.id}`);
                      })
                    }
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <form
              onSubmit={(e) => addRule(e, c)}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
            >
              <label className="field" style={{ flex: '2 1 160px' }}>
                <span>Stichwort</span>
                <input
                  value={input.pattern}
                  onChange={(e) => setRule({ ...rule, [c.id]: { ...input, pattern: e.target.value } })}
                  maxLength={60}
                  data-testid="rule-pattern"
                />
              </label>
              <label className="field" style={{ flex: '1 1 160px' }}>
                <span>Suchen in</span>
                <select
                  value={input.field}
                  onChange={(e) =>
                    setRule({ ...rule, [c.id]: { ...input, field: e.target.value as RuleField } })
                  }
                >
                  {FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="btn"
                disabled={busy || !input.pattern.trim()}
                data-testid="rule-add"
              >
                Regel hinzufügen
              </button>
            </form>
          </div>
        );
      })}
    </section>
  );
}
