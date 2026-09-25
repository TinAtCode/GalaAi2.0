import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { formatEuro } from '../format';
import { quantityText } from '../rounding';

interface Deviation {
  planned: number;
  actual: number;
  deviationAbs: number;
  deviationPercent: number | null;
}

interface PostCalculation {
  orders: number;
  labor: Deviation; // Minuten
  material: Deviation | null; // Euro, ohne Einkaufspreis-Recht null
  // Eingangsrechnungen am Projekt, netto (ohne Einkaufspreis-Recht null)
  purchases: { count: number; net: number } | null;
  // nur mit Einkaufspreisen und Rechnungsrecht
  margin: {
    orderValue: number;
    invoiced: number;
    costs: { labor: number; material: number; purchases: number; total: number };
    hourlyRate: number;
    contribution: number;
    contributionPercent: number | null;
  } | null;
}

// Deckungsbeitrag: Umsatz laut Rechnungen gegen die Ist-Kosten
function MarginTable({ margin }: { margin: NonNullable<PostCalculation['margin']> }) {
  const negative = margin.contribution < 0;
  return (
    <div data-testid="postcalc-margin" style={{ marginTop: 12 }}>
      <div className="list-item-name">Deckungsbeitrag</div>
      <table className="plain-table" style={{ width: '100%', marginTop: 4 }}>
        <tbody>
          <tr>
            <td>Umsatz (Rechnungen netto)</td>
            <td style={{ textAlign: 'right' }}>{formatEuro(margin.invoiced)}</td>
          </tr>
          <tr className="list-item-meta">
            <td>Lohn ({formatEuro(margin.hourlyRate)}/h)</td>
            <td style={{ textAlign: 'right' }}>− {formatEuro(margin.costs.labor)}</td>
          </tr>
          <tr className="list-item-meta">
            <td>Material (Verbrauch)</td>
            <td style={{ textAlign: 'right' }}>− {formatEuro(margin.costs.material)}</td>
          </tr>
          <tr className="list-item-meta">
            <td>Eingangsrechnungen</td>
            <td style={{ textAlign: 'right' }}>− {formatEuro(margin.costs.purchases)}</td>
          </tr>
          <tr>
            <td>
              <strong>Deckungsbeitrag</strong>
            </td>
            <td
              style={{ textAlign: 'right', color: negative ? 'var(--color-danger)' : undefined }}
              data-testid="postcalc-contribution"
            >
              <strong>{formatEuro(margin.contribution)}</strong>
              {margin.contributionPercent !== null &&
                ` (${margin.contributionPercent.toLocaleString('de-DE')} %)`}
            </td>
          </tr>
        </tbody>
      </table>
      {margin.costs.material > 0 && margin.costs.purchases > 0 && (
        <p className="list-item-meta" data-testid="postcalc-double-hint">
          Hinweis: Materialverbrauch und Eingangsrechnungen zählen beide. Lagermaterial als Verbrauch
          erfassen, direkt gelieferte Ware nur über die Eingangsrechnung – sonst steht sie doppelt in den
          Kosten.
        </p>
      )}
      {margin.orderValue > margin.invoiced && (
        <p className="list-item-meta" style={{ marginBottom: 0 }}>
          Auftragswert {formatEuro(margin.orderValue)} – noch{' '}
          {formatEuro(margin.orderValue - margin.invoiced)} nicht berechnet.
        </p>
      )}
    </div>
  );
}

const hours = (minutes: number) =>
  `${(minutes / 60).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`;

function Row({ label, value, format }: { label: string; value: Deviation; format: (n: number) => string }) {
  const share = value.planned > 0 ? Math.min(100, (value.actual / value.planned) * 100) : 0;
  const over = value.planned > 0 && value.actual > value.planned;
  return (
    <div
      style={{ marginBottom: 14 }}
      data-testid={`postcalc-${label === 'Arbeitszeit' ? 'labor' : 'material'}`}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span className="list-item-name">{label}</span>
        <span className="list-item-meta">
          {format(value.actual)} von {format(value.planned)}
        </span>
      </div>
      <div className="meter" aria-hidden="true">
        <span className={over ? 'over' : undefined} style={{ width: `${value.planned > 0 ? share : 0}%` }} />
      </div>
      <div className="list-item-meta" style={{ color: over ? 'var(--color-danger)' : undefined }}>
        {value.deviationPercent === null
          ? 'Kein Soll (noch kein Auftrag mit Rezeptur)'
          : `${value.deviationAbs > 0 ? '+' : ''}${format(value.deviationAbs)} (${value.deviationPercent > 0 ? '+' : ''}${value.deviationPercent.toLocaleString('de-DE')} %)`}
      </div>
    </div>
  );
}

// Nachkalkulation: Soll aus den Aufträgen, Ist aus Zeiten und Material
export function PostCalculationCard({
  projectId,
  reloadKey,
  canSeePayables = false,
}: {
  projectId: string;
  reloadKey: number;
  canSeePayables?: boolean;
}) {
  const [data, setData] = useState<PostCalculation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api
      .get<PostCalculation>(`/post-calculation/${projectId}`)
      .then((result) => current && setData(result))
      .catch(
        (err) =>
          current &&
          setError(err instanceof ApiError ? err.message : 'Nachkalkulation konnte nicht geladen werden.'),
      );
    return () => {
      current = false;
    };
  }, [projectId, reloadKey]);

  return (
    <section className="card" id="nachkalkulation" data-testid="postcalc">
      <h3>Nachkalkulation</h3>
      {error && <p className="field-error">{error}</p>}
      {data && (
        <>
          <p className="list-item-meta" style={{ marginTop: 0 }}>
            Soll aus {data.orders} {data.orders === 1 ? 'Auftrag' : 'Aufträgen'}, Ist aus erfassten Zeiten
            {data.material ? ' und Material' : ''}.
          </p>
          <Row label="Arbeitszeit" value={data.labor} format={hours} />
          {data.material && <Row label="Material" value={data.material} format={formatEuro} />}
          {data.purchases && data.purchases.count > 0 && (
            <p className="list-item-meta" data-testid="postcalc-purchases">
              Eingangsrechnungen am Projekt: {data.purchases.count} · {formatEuro(data.purchases.net)} netto
              {canSeePayables && (
                <>
                  {' · '}
                  <Link to={`/finanzen?tab=payables&projekt=${projectId}`}>ansehen</Link>
                </>
              )}
            </p>
          )}
          {data.margin && <MarginTable margin={data.margin} />}
        </>
      )}
    </section>
  );
}

interface Article {
  id: string;
  name: string;
  unit: string;
  articleNumber: string;
}

interface Usage {
  id: string;
  quantity: string;
  createdAt: string;
  article: { name: string; unit: string; purchasePrice?: string };
}

// Materialverbrauch auf der Baustelle erfassen (fließt in die Nachkalkulation)
export function MaterialCard({
  projectId,
  canWrite,
  onChange,
}: {
  projectId: string;
  canWrite: boolean;
  onChange: () => void;
}) {
  const [usages, setUsages] = useState<Usage[] | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [articleId, setArticleId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<Usage[]>(`/material-usage/by-project/${projectId}`)
      .then(setUsages)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Material konnte nicht geladen werden.'),
      );
  }, [projectId]);

  useEffect(load, [load]);
  useEffect(() => {
    if (!canWrite) return;
    api
      .get<Article[]>('/articles?take=500')
      .then(setArticles)
      .catch(() => setArticles([]));
  }, [canWrite]);

  const record = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(quantity.replace(',', '.'));
    if (!articleId || !(amount > 0)) {
      setError('Bitte Artikel und Menge angeben.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/material-usage', { projectId, articleId, quantity: amount });
      setQuantity('');
      load();
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Material konnte nicht erfasst werden.');
    } finally {
      setBusy(false);
    }
  };

  const unit = articles.find((a) => a.id === articleId)?.unit;

  return (
    <section className="card" id="material" data-testid="material">
      <h3>Materialverbrauch</h3>
      {error && <p className="field-error">{error}</p>}
      {usages?.length === 0 && <p className="list-item-meta">Noch nichts erfasst.</p>}
      {usages?.map((u) => (
        <div key={u.id} className="list-item" style={{ padding: '8px 0' }} data-testid="material-item">
          <div>
            <div className="list-item-name">{u.article.name}</div>
            <div className="list-item-meta">{new Date(u.createdAt).toLocaleDateString('de-DE')}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div>
              {quantityText(u.quantity)} {u.article.unit}
            </div>
            {u.article.purchasePrice !== undefined && (
              <div className="list-item-meta">
                {formatEuro(Number(u.quantity) * Number(u.article.purchasePrice))}
              </div>
            )}
          </div>
        </div>
      ))}
      {canWrite && (
        <form onSubmit={record} style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <select
            value={articleId}
            onChange={(e) => setArticleId(e.target.value)}
            aria-label="Artikel"
            data-testid="material-article"
          >
            <option value="">– Artikel wählen –</option>
            {articles.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.unit})
              </option>
            ))}
          </select>
          <div className="form-row">
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
              placeholder={unit ? `Menge in ${unit}` : 'Menge'}
              aria-label="Menge"
              data-testid="material-quantity"
            />
            <button className="btn btn-primary" disabled={busy} data-testid="material-submit">
              Erfassen
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
