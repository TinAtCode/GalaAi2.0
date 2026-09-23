import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { formatEuro } from '../../format';
import { Category, day } from './shared';

interface Transaction {
  id: string;
  bookingDate: string;
  direction: 'credit' | 'debit';
  reversal: boolean;
  amount: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  remittance: string | null;
  category: { id: string; name: string } | null;
  categorySource: 'rule' | 'learned' | 'manual' | null;
}

const PAGE_SIZE = 50;
const SOURCE: Record<string, string> = { rule: 'per Regel', learned: 'gelernt', manual: 'von Hand' };

// Kontobewegungen mit Filter; Abbuchungen lassen sich einer Kategorie
// zuordnen – der Empfänger wird dabei gelernt.
export function TransactionsTab() {
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState({ direction: '', category: '', q: '', from: '', to: '' });
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  // nach einer Zuordnung von Hand: anbieten, daraus eine feste Regel zu machen
  const [assigned, setAssigned] = useState<{ tx: Transaction; categoryId: string; also: number } | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latestLoad = useRef(0);

  useEffect(() => {
    api
      .get<Category[]>('/finance/categories')
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const path = useCallback(() => {
    const p = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) if (value) p.set(key, value);
    // Kategorie gibt es nur für Abbuchungen
    if (filter.category && !filter.direction) p.set('direction', 'debit');
    const text = p.toString();
    return `/finance/transactions${text ? `?${text}` : ''}`;
  }, [filter]);

  const load = useCallback(
    (skip = 0) => {
      const requestId = ++latestLoad.current;
      return api
        .getPage<Transaction>(path(), PAGE_SIZE, skip)
        .then(({ items, total: count }) => {
          if (requestId !== latestLoad.current) return;
          setTransactions((current) => (skip === 0 ? items : [...(current ?? []), ...items]));
          setTotal(count);
        })
        .catch((err) => {
          if (requestId === latestLoad.current)
            setError(err instanceof ApiError ? err.message : 'Kontobewegungen konnten nicht geladen werden.');
        });
    },
    [path],
  );

  useEffect(() => {
    load();
  }, [load]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    setFilter({ ...filter, q: query.trim() });
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  // Abbuchungen ohne Kategorie (auch aus älteren Kontoauszügen) zuordnen
  const categorize = () =>
    run(async () => {
      const { assigned: count } = await api.post<{ assigned: number }>('/finance/transactions/categorize');
      setAssigned(null);
      setNotice(
        count
          ? `${count} Abbuchung${count === 1 ? '' : 'en'} zugeordnet.`
          : 'Keine weitere Abbuchung passt zu Gelerntem oder einer Regel.',
      );
      await load();
    });

  const assign = (tx: Transaction, categoryId: string, createRule = false) =>
    run(async () => {
      setNotice(null);
      const result = await api.patch<{ categoryId: string | null; alsoAssigned: number }>(
        `/finance/transactions/${tx.id}`,
        { categoryId: categoryId || null, createRule },
      );
      setAssigned(categoryId && !createRule ? { tx, categoryId, also: result.alsoAssigned } : null);
      // alle Einträge neu laden: gleiche Empfänger wurden evtl. mit zugeordnet
      await load();
    });

  const assignedName = assigned && categories.find((c) => c.id === assigned.categoryId)?.name;
  return (
    <section>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
        <label className="field">
          <span>Art</span>
          <select
            value={filter.direction}
            onChange={(e) =>
              setFilter({
                ...filter,
                direction: e.target.value,
                category: e.target.value === 'credit' ? '' : filter.category,
              })
            }
            data-testid="finance-direction"
          >
            <option value="">Alle</option>
            <option value="credit">Eingänge</option>
            <option value="debit">Ausgaben</option>
          </select>
        </label>
        <label className="field">
          <span>Kategorie</span>
          <select
            value={filter.category}
            disabled={filter.direction === 'credit'}
            onChange={(e) => setFilter({ ...filter, category: e.target.value })}
            data-testid="finance-category-filter"
          >
            <option value="">Alle</option>
            <option value="none">ohne Kategorie</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Von</span>
          <input
            type="date"
            value={filter.from}
            onChange={(e) => setFilter({ ...filter, from: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Bis</span>
          <input
            type="date"
            value={filter.to}
            onChange={(e) => setFilter({ ...filter, to: e.target.value })}
          />
        </label>
        <button
          className="btn"
          disabled={busy}
          onClick={categorize}
          title="Abbuchungen ohne Kategorie nach Gelerntem und Regeln zuordnen"
          data-testid="finance-categorize"
        >
          Automatisch zuordnen
        </button>
        <form onSubmit={search} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <label className="field">
            <span>Suche</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, IBAN oder Verwendungszweck"
              maxLength={100}
              data-testid="finance-search"
            />
          </label>
          <button type="submit" className="btn">
            Suchen
          </button>
        </form>
      </div>
      {error && <p className="field-error">{error}</p>}
      {notice && (
        <p className="list-item-meta" data-testid="finance-categorize-notice">
          {notice}
        </p>
      )}
      {assigned && assignedName && (
        <div className="list-item-meta" style={{ margin: '4px 0 8px' }} data-testid="finance-assigned">
          {assigned.tx.counterpartyName ?? 'Empfänger'} → {assignedName}
          {assigned.also > 0 &&
            `, ${assigned.also} weitere offene Abbuchung${assigned.also === 1 ? '' : 'en'} mit`}
          . Künftige Abbuchungen dieses Empfängers bekommen die Kategorie automatisch.{' '}
          <button
            className="btn"
            disabled={busy}
            onClick={() => assign(assigned.tx, assigned.categoryId, true)}
            data-testid="finance-make-rule"
          >
            Als feste Regel speichern
          </button>
        </div>
      )}
      {transactions === null && !error && <p>Lädt …</p>}
      {transactions?.length === 0 && <p className="list-item-meta">Keine Kontobewegungen.</p>}
      {transactions?.map((t) => (
        <div key={t.id} className="list-item" data-testid="finance-transaction" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <div className="list-item-name">{t.counterpartyName ?? 'Unbekannt'}</div>
            <div className="list-item-meta">
              {day(t.bookingDate)}
              {t.reversal && ' · Rückbuchung'}
              {t.remittance && ` · ${t.remittance}`}
            </div>
          </div>
          {t.direction === 'debit' && (
            <label className="field" style={{ flex: '0 1 180px', margin: 0 }}>
              <span>
                Kategorie
                {t.categorySource && t.categorySource !== 'manual' && t.category && (
                  <span className="list-item-meta"> · {SOURCE[t.categorySource]}</span>
                )}
              </span>
              <select
                value={t.category?.id ?? ''}
                disabled={busy}
                onChange={(e) => assign(t, e.target.value)}
                data-testid="finance-transaction-category"
              >
                <option value="">– ohne –</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <strong data-testid="finance-transaction-amount" style={{ minWidth: 100, textAlign: 'right' }}>
            {t.direction === 'credit' ? '+' : '−'}
            {formatEuro(t.amount)}
          </strong>
        </div>
      ))}
      {transactions && transactions.length < total && (
        <button className="btn" onClick={() => load(transactions.length)} data-testid="finance-more">
          Weitere laden ({total - transactions.length})
        </button>
      )}
    </section>
  );
}
