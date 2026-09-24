import { FormEvent, useCallback, useEffect, useState } from 'react';
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
export function PostCalculationCard({ projectId, reloadKey }: { projectId: string; reloadKey: number }) {
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
