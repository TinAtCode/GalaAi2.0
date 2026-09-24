import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { formatEuro, parseAmount } from '../../format';
import { Category, day, Interval, intervalLabel, INTERVALS } from './shared';

interface Recurring {
  id: string;
  name: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  amount: string;
  interval: Interval;
  nextDue: string;
  endDate: string | null;
  categoryId: string | null;
  active: boolean;
}

interface Suggestion {
  key: string;
  name: string;
  counterpartyIban: string | null;
  interval: Interval;
  amount: string;
  occurrences: number;
  lastDate: string;
  nextDue: string;
  categoryId: string | null;
}

interface Form {
  id?: string;
  name: string;
  counterpartyName: string;
  counterpartyIban: string;
  amount: string;
  interval: Interval;
  nextDue: string;
  endDate: string;
  categoryId: string;
}

const EMPTY: Form = {
  name: '',
  counterpartyName: '',
  counterpartyIban: '',
  amount: '',
  interval: 'monthly',
  nextDue: '',
  endDate: '',
  categoryId: '',
};
const PER_MONTH: Record<Interval, number> = { monthly: 1, quarterly: 3, halfyearly: 6, yearly: 12 };
const amountText = (value: string) => Number(value).toFixed(2).replace('.', ',');

// Fixkosten: wiederkehrende Zahlungen (Miete, Leasing, Versicherungen …).
// Vorschläge kommen aus den Abbuchungen der letzten 13 Monate.
export function RecurringTab() {
  const [list, setList] = useState<Recurring[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      Promise.all([
        api.get<Recurring[]>('/finance/recurring'),
        api.get<Suggestion[]>('/finance/recurring/suggestions'),
        api.get<Category[]>('/finance/categories'),
      ])
        .then(([items, found, cats]) => {
          setList(items);
          setSuggestions(found);
          setCategories(cats);
        })
        .catch((err) =>
          setError(err instanceof ApiError ? err.message : 'Fixkosten konnten nicht geladen werden.'),
        ),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const amount = parseAmount(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Bitte einen gültigen Betrag angeben.');
      return;
    }
    if (!form.nextDue) {
      setError('Bitte die nächste Fälligkeit angeben.');
      return;
    }
    const body = {
      name: form.name.trim(),
      counterpartyName: form.counterpartyName.trim() || null,
      counterpartyIban: form.counterpartyIban.trim() || null,
      amount,
      interval: form.interval,
      nextDue: form.nextDue,
      endDate: form.endDate || null,
      categoryId: form.categoryId || null,
    };
    run(async () => {
      if (form.id) await api.patch(`/finance/recurring/${form.id}`, body);
      else await api.post('/finance/recurring', body);
      setForm(null);
    });
  };

  const adopt = (s: Suggestion) =>
    setForm({
      ...EMPTY,
      name: s.name,
      counterpartyName: s.name,
      counterpartyIban: s.counterpartyIban ?? '',
      amount: amountText(s.amount),
      interval: s.interval,
      nextDue: s.nextDue,
      categoryId: s.categoryId ?? '',
    });

  const edit = (r: Recurring) =>
    setForm({
      id: r.id,
      name: r.name,
      counterpartyName: r.counterpartyName ?? '',
      counterpartyIban: r.counterpartyIban ?? '',
      amount: amountText(r.amount),
      interval: r.interval,
      nextDue: r.nextDue,
      endDate: r.endDate ?? '',
      categoryId: r.categoryId ?? '',
    });

  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name;
  const perMonth = (list ?? [])
    .filter((r) => r.active)
    .reduce((sum, r) => sum + Number(r.amount) / PER_MONTH[r.interval], 0);

  return (
    <section>
      <p className="list-item-meta">
        Wiederkehrende Zahlungen erscheinen im Jahresüberblick als geplante Ausgaben, bis die passende
        Abbuchung im Kontoauszug steht (gleicher Empfänger, Betrag höchstens 10 % daneben).
      </p>
      {error && <p className="field-error">{error}</p>}

      {form ? (
        <form
          onSubmit={save}
          className="job-card"
          style={{ display: 'block', margin: '12px 0' }}
          data-testid="recurring-form"
        >
          <h3 style={{ marginTop: 0 }}>{form.id ? 'Fixkosten bearbeiten' : 'Neue Fixkosten'}</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: '2 1 220px' }}>
              <span>Bezeichnung</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={80}
                required
                minLength={2}
                data-testid="recurring-name"
              />
            </label>
            <label className="field" style={{ flex: '1 1 120px' }}>
              <span>Betrag (€)</span>
              <input
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                inputMode="decimal"
                required
                data-testid="recurring-amount"
              />
            </label>
            <label className="field" style={{ flex: '1 1 150px' }}>
              <span>Rhythmus</span>
              <select
                value={form.interval}
                onChange={(e) => setForm({ ...form, interval: e.target.value as Interval })}
                data-testid="recurring-interval"
              >
                {INTERVALS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: '1 1 150px' }}>
              <span>Nächste Fälligkeit</span>
              <input
                type="date"
                value={form.nextDue}
                onChange={(e) => setForm({ ...form, nextDue: e.target.value })}
                required
                data-testid="recurring-next-due"
              />
            </label>
            <label className="field" style={{ flex: '1 1 150px' }}>
              <span>Endet am (optional)</span>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </label>
            <label className="field" style={{ flex: '1 1 160px' }}>
              <span>Kategorie</span>
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                <option value="">– ohne –</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: '2 1 200px' }}>
              <span>Empfänger laut Kontoauszug</span>
              <input
                value={form.counterpartyName}
                onChange={(e) => setForm({ ...form, counterpartyName: e.target.value })}
                maxLength={140}
              />
            </label>
            <label className="field" style={{ flex: '2 1 200px' }}>
              <span>IBAN des Empfängers</span>
              <input
                value={form.counterpartyIban}
                onChange={(e) => setForm({ ...form, counterpartyIban: e.target.value })}
                maxLength={40}
              />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={busy} data-testid="recurring-save">
              Speichern
            </button>
            <button type="button" className="btn" onClick={() => setForm(null)}>
              Abbrechen
            </button>
          </div>
        </form>
      ) : (
        <button
          className="btn btn-primary"
          style={{ margin: '8px 0 12px' }}
          onClick={() => setForm(EMPTY)}
          data-testid="recurring-new"
        >
          Fixkosten anlegen
        </button>
      )}

      {suggestions.length > 0 && (
        <div style={{ margin: '8px 0 20px' }} data-testid="recurring-suggestions">
          <h3 style={{ marginBottom: 4 }}>Erkannt im Kontoauszug</h3>
          {suggestions.map((s) => (
            <div
              key={s.key}
              className="list-item"
              data-testid="recurring-suggestion"
              style={{ flexWrap: 'wrap' }}
            >
              <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                <div className="list-item-name">
                  {s.name} · {formatEuro(s.amount)} {intervalLabel(s.interval)}
                </div>
                <div className="list-item-meta">
                  {s.occurrences}× abgebucht, zuletzt {day(s.lastDate)} · nächste voraussichtlich{' '}
                  {day(s.nextDue)}
                </div>
              </div>
              <button className="btn" onClick={() => adopt(s)} data-testid="recurring-adopt">
                Übernehmen
              </button>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ marginBottom: 4 }}>
        Fixkosten{list && list.length > 0 && ` · ${formatEuro(perMonth)} je Monat`}
      </h3>
      {list === null && !error && <p>Lädt …</p>}
      {list?.length === 0 && <p className="list-item-meta">Noch keine Fixkosten angelegt.</p>}
      {list?.map((r) => (
        <div
          key={r.id}
          className="list-item"
          data-testid="recurring"
          style={{ opacity: r.active ? 1 : 0.6, flexWrap: 'wrap' }}
        >
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div className="list-item-name">
              {r.name} · {formatEuro(r.amount)} {intervalLabel(r.interval)}
            </div>
            <div className="list-item-meta">
              {r.active ? `nächste Fälligkeit ${day(r.nextDue)}` : 'pausiert'}
              {r.endDate && ` · bis ${day(r.endDate)}`}
              {categoryName(r.categoryId) && ` · ${categoryName(r.categoryId)}`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => edit(r)}>
              Bearbeiten
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.patch(`/finance/recurring/${r.id}`, { active: !r.active });
                })
              }
              data-testid="recurring-toggle"
            >
              {r.active ? 'Pausieren' : 'Fortsetzen'}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`„${r.name}“ löschen?`))
                  run(async () => {
                    await api.delete(`/finance/recurring/${r.id}`);
                  });
              }}
            >
              Löschen
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
