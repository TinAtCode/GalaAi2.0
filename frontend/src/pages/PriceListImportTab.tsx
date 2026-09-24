import { ChangeEvent, useState } from 'react';
import { api, ApiError } from '../api/client';
import { formatEuro } from '../format';

interface Row {
  articleNumber: string;
  name: string;
  unit: string;
  purchasePrice: number;
  salePrice: number;
}

interface Diff {
  newArticles: Row[];
  priceChanges: {
    articleNumber: string;
    name: string;
    field: 'purchasePrice' | 'salePrice';
    oldValue: number;
    newValue: number;
  }[];
  unitChanges: { articleNumber: string; name: string; oldUnit: string; newUnit: string }[];
  unchangedCount: number;
}

interface Result {
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
}

const FIELD_LABELS = { purchasePrice: 'EK', salePrice: 'VK' } as const;

// Lieferanten-Preisliste (CSV oder Excel) einlesen: Vorschau der Änderungen,
// jede Zeile einzeln übernehmen oder auslassen – erst „Übernehmen“ schreibt
export function PriceListImportTab() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.upload<{ rows: Row[]; diff: Diff }>('/data-guardian/price-list/upload', file);
      setRows(res.rows);
      setDiff(res.diff);
      setFileName(file.name);
      // standardmäßig alles übernehmen, was sich ändert oder neu ist
      setAccepted(
        new Set([
          ...res.diff.newArticles.map((r) => r.articleNumber),
          ...res.diff.priceChanges.map((c) => c.articleNumber),
          ...res.diff.unitChanges.map((c) => c.articleNumber),
        ]),
      );
    } catch (err) {
      setRows(null);
      setDiff(null);
      setError(err instanceof ApiError ? err.message : 'Die Datei konnte nicht gelesen werden.');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<Result>('/data-guardian/price-list/apply', {
        rows,
        acceptedArticleNumbers: [...accepted],
      });
      setResult(res);
      setRows(null);
      setDiff(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Die Preisliste konnte nicht übernommen werden.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (articleNumber: string) => {
    const next = new Set(accepted);
    if (next.has(articleNumber)) next.delete(articleNumber);
    else next.add(articleNumber);
    setAccepted(next);
  };

  const check = (articleNumber: string) => (
    <input
      type="checkbox"
      checked={accepted.has(articleNumber)}
      onChange={() => toggle(articleNumber)}
      aria-label={`${articleNumber} übernehmen`}
      data-testid="pricelist-accept"
    />
  );

  // Änderungen je Artikel zusammenfassen (Preis und Einheit)
  const changed = diff
    ? [...new Set([...diff.priceChanges, ...diff.unitChanges].map((c) => c.articleNumber))].map((nr) => ({
        articleNumber: nr,
        name: [...diff.priceChanges, ...diff.unitChanges].find((c) => c.articleNumber === nr)!.name,
        prices: diff.priceChanges.filter((c) => c.articleNumber === nr),
        unit: diff.unitChanges.find((c) => c.articleNumber === nr),
      }))
    : [];

  return (
    <div data-testid="pricelist">
      <section className="card">
        <h3>Preisliste einlesen</h3>
        <p className="list-item-meta" style={{ marginTop: 4 }}>
          CSV oder Excel mit den Spalten Artikelnummer, Bezeichnung, Einheit, Einkaufspreis und Verkaufspreis
          (auch „EK“, „VK“, „ME“). Du siehst vorher, was sich ändert, und wählst aus, was übernommen wird.
        </p>
        <label className="btn btn-primary">
          {busy ? 'Liest …' : 'Datei wählen …'}
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={upload}
            style={{ display: 'none' }}
            disabled={busy}
            data-testid="pricelist-file"
          />
        </label>
        {error && (
          <p className="field-error" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}
        {result && (
          <p style={{ marginTop: 10 }} data-testid="pricelist-result">
            Übernommen: {result.createdCount} neu, {result.updatedCount} geändert
            {result.skippedCount ? `, ${result.skippedCount} ausgelassen` : ''}.
          </p>
        )}
      </section>

      {diff && (
        <section className="card" data-testid="pricelist-preview">
          <div className="card-header">
            <h3>Vorschau: {fileName}</h3>
            <span className="list-item-meta">{diff.unchangedCount} unverändert</span>
          </div>

          {!diff.newArticles.length && !changed.length && (
            <p className="list-item-meta">Keine Änderungen – die Preise sind aktuell.</p>
          )}

          {diff.newArticles.length > 0 && (
            <>
              <h4 style={{ margin: '12px 0 6px' }}>Neue Artikel ({diff.newArticles.length})</h4>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th />
                      <th>Artikel</th>
                      <th>Einheit</th>
                      <th>EK</th>
                      <th>VK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.newArticles.map((r) => (
                      <tr key={r.articleNumber}>
                        <td style={{ width: 32 }}>{check(r.articleNumber)}</td>
                        <td style={{ textAlign: 'left' }}>
                          {r.name} <span className="list-item-meta">{r.articleNumber}</span>
                        </td>
                        <td>{r.unit}</td>
                        <td>{formatEuro(r.purchasePrice)}</td>
                        <td>{formatEuro(r.salePrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {changed.length > 0 && (
            <>
              <h4 style={{ margin: '16px 0 6px' }}>Geänderte Artikel ({changed.length})</h4>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th />
                      <th>Artikel</th>
                      <th>Änderung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changed.map((c) => (
                      <tr key={c.articleNumber}>
                        <td style={{ width: 32 }}>{check(c.articleNumber)}</td>
                        <td style={{ textAlign: 'left' }}>
                          {c.name} <span className="list-item-meta">{c.articleNumber}</span>
                        </td>
                        <td>
                          {c.prices.map((p) => {
                            const up = p.newValue > p.oldValue;
                            const pct =
                              p.oldValue > 0 ? ((p.newValue - p.oldValue) / p.oldValue) * 100 : null;
                            return (
                              <div key={p.field}>
                                {FIELD_LABELS[p.field]} {formatEuro(p.oldValue)} → {formatEuro(p.newValue)}{' '}
                                {pct !== null && (
                                  <span
                                    style={{ color: up ? 'var(--color-danger)' : 'var(--color-success)' }}
                                  >
                                    ({up ? '+' : ''}
                                    {pct.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %)
                                  </span>
                                )}
                              </div>
                            );
                          })}
                          {c.unit && (
                            <div>
                              Einheit {c.unit.oldUnit} → {c.unit.newUnit}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button
              className="btn btn-primary"
              disabled={busy || accepted.size === 0}
              onClick={apply}
              data-testid="pricelist-apply"
            >
              {accepted.size} Artikel übernehmen
            </button>
            <button
              className="btn"
              onClick={() => {
                setRows(null);
                setDiff(null);
              }}
            >
              Verwerfen
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
