import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface Article {
  id: string;
  articleNumber: string;
  name: string;
  unit: string;
  purchasePrice?: number;
  salePrice?: number;
}
interface Supplier {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}
interface Machine {
  id: string;
  name: string;
  hourlyRate?: number;
}

type Tab = 'articles' | 'suppliers' | 'machines';

function formatEuro(value?: number): string {
  if (value === undefined) return '–';
  return value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

export function MasterDataPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('masterdata.write');
  const [tab, setTab] = useState<Tab>('articles');

  return (
    <div>
      <header className="my-day-header">
        <h2>Stammdaten</h2>
      </header>

      <div className="tab-bar">
        <button className={tab === 'articles' ? 'active' : ''} onClick={() => setTab('articles')} data-testid="tab-articles">
          Artikel
        </button>
        <button className={tab === 'suppliers' ? 'active' : ''} onClick={() => setTab('suppliers')} data-testid="tab-suppliers">
          Lieferanten
        </button>
        <button className={tab === 'machines' ? 'active' : ''} onClick={() => setTab('machines')} data-testid="tab-machines">
          Maschinen
        </button>
      </div>

      {tab === 'articles' && <ArticlesTab canWrite={canWrite} />}
      {tab === 'suppliers' && <SuppliersTab canWrite={canWrite} />}
      {tab === 'machines' && <MachinesTab canWrite={canWrite} />}
    </div>
  );
}

function ArticlesTab({ canWrite }: { canWrite: boolean }) {
  const [items, setItems] = useState<Article[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    articleNumber: '',
    name: '',
    unit: '',
    purchasePrice: '',
    salePrice: '',
  });

  const load = () =>
    api
      .get<Article[]>('/articles')
      .then(setItems)
      .catch((e) => setError(errMsg(e)));
  useEffect(() => {
    load();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/articles', {
        articleNumber: form.articleNumber,
        name: form.name,
        unit: form.unit,
        purchasePrice: Number(form.purchasePrice),
        salePrice: Number(form.salePrice),
      });
      setForm({ articleNumber: '', name: '', unit: '', purchasePrice: '', salePrice: '' });
      load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <div>
      {error && <p className="field-error">{error}</p>}
      {items === null && <p>Lädt …</p>}
      {items?.map((a) => (
        <div key={a.id} className="list-item" data-testid="article-item">
          <div>
            <div className="list-item-name">{a.name}</div>
            <div className="list-item-meta">
              {a.articleNumber} · {a.unit}
            </div>
          </div>
          <div className="list-item-meta">
            EK {formatEuro(a.purchasePrice)} / VK {formatEuro(a.salePrice)}
          </div>
        </div>
      ))}

      {canWrite && (
        <form onSubmit={submit} className="login-form" style={{ marginTop: 20 }}>
          <div className="form-row">
            <input
              placeholder="Artikelnummer"
              value={form.articleNumber}
              onChange={(e) => setForm({ ...form, articleNumber: e.target.value })}
              required
              data-testid="article-number"
            />
            <input
              placeholder="Bezeichnung"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              data-testid="article-name"
            />
          </div>
          <div className="form-row">
            <input
              placeholder="Einheit (z.B. Stk)"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              required
              data-testid="article-unit"
            />
            <input
              placeholder="EK-Preis"
              type="number"
              step="0.01"
              value={form.purchasePrice}
              onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })}
              required
              data-testid="article-purchase-price"
            />
            <input
              placeholder="VK-Preis"
              type="number"
              step="0.01"
              value={form.salePrice}
              onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
              required
              data-testid="article-sale-price"
            />
          </div>
          <button type="submit" className="btn btn-primary" data-testid="article-submit">
            Artikel anlegen
          </button>
        </form>
      )}
    </div>
  );
}

function SuppliersTab({ canWrite }: { canWrite: boolean }) {
  const [items, setItems] = useState<Supplier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });

  const load = () =>
    api
      .get<Supplier[]>('/suppliers')
      .then(setItems)
      .catch((e) => setError(errMsg(e)));
  useEffect(() => {
    load();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/suppliers', {
        name: form.name,
        email: form.email || undefined,
        phone: form.phone || undefined,
      });
      setForm({ name: '', email: '', phone: '' });
      load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <div>
      {error && <p className="field-error">{error}</p>}
      {items === null && <p>Lädt …</p>}
      {items?.map((s) => (
        <div key={s.id} className="list-item">
          <div>
            <div className="list-item-name">{s.name}</div>
            {s.email && <div className="list-item-meta">{s.email}</div>}
          </div>
        </div>
      ))}

      {canWrite && (
        <form onSubmit={submit} className="login-form" style={{ marginTop: 20 }}>
          <div className="form-row">
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <input
              placeholder="E-Mail (optional)"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Lieferant anlegen
          </button>
        </form>
      )}
    </div>
  );
}

function MachinesTab({ canWrite }: { canWrite: boolean }) {
  const [items, setItems] = useState<Machine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', hourlyRate: '' });

  const load = () =>
    api
      .get<Machine[]>('/machines')
      .then(setItems)
      .catch((e) => setError(errMsg(e)));
  useEffect(() => {
    load();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/machines', { name: form.name, hourlyRate: Number(form.hourlyRate) });
      setForm({ name: '', hourlyRate: '' });
      load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <div>
      {error && <p className="field-error">{error}</p>}
      {items === null && <p>Lädt …</p>}
      {items?.map((m) => (
        <div key={m.id} className="list-item">
          <div className="list-item-name">{m.name}</div>
          <div className="list-item-meta">{formatEuro(m.hourlyRate)}/h</div>
        </div>
      ))}

      {canWrite && (
        <form onSubmit={submit} className="login-form" style={{ marginTop: 20 }}>
          <div className="form-row">
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <input
              placeholder="Stundensatz"
              type="number"
              step="0.01"
              value={form.hourlyRate}
              onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Maschine anlegen
          </button>
        </form>
      )}
    </div>
  );
}

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Etwas ist schiefgelaufen.';
}
