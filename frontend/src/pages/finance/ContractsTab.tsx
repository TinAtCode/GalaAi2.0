import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { formatEuro, parseAmount } from '../../format';
import { DonutChart } from '../../components/DonutChart';
import { Category, day, Interval, intervalLabel, INTERVALS } from './shared';

type Kind =
  'insurance' | 'vehicle' | 'lease' | 'rent' | 'telecom' | 'software' | 'energy' | 'service' | 'other';
type State = 'active' | 'notice_soon' | 'cancelled' | 'expired' | 'open_ended';

const KINDS: Record<Kind, string> = {
  insurance: 'Versicherung',
  vehicle: 'Kfz-Versicherung',
  lease: 'Leasing/Finanzierung',
  rent: 'Miete/Pacht',
  telecom: 'Telefon/Internet',
  software: 'Software',
  energy: 'Strom/Gas/Wasser',
  service: 'Wartung/Dienstleistung',
  other: 'Sonstiges',
};

const STATE: Record<State, { label: string; badge: string }> = {
  notice_soon: { label: 'Kündigungsfrist naht', badge: 'status-overdue' },
  active: { label: 'läuft', badge: 'status-done' },
  open_ended: { label: 'unbefristet', badge: 'status-done' },
  cancelled: { label: 'gekündigt', badge: 'status-open' },
  expired: { label: 'beendet', badge: '' },
};

interface Contract {
  id: string;
  name: string;
  kind: Kind;
  provider: string | null;
  contractNumber: string | null;
  amount: number | null;
  interval: Interval | null;
  startDate: string | null;
  termEnd: string | null;
  renewalMonths: number | null;
  noticeMonths: number;
  cancelledOn: string | null;
  notes: string | null;
  recurringPaymentId: string | null;
  yearly: number | null;
  state: State;
  endsOn: string | null;
  noticeDeadline: string | null;
  daysToDeadline: number | null;
}

interface ContractList {
  today: string;
  contracts: Contract[];
  summary: { yearlyTotal: number; byKind: Record<string, number>; noticeSoon: number };
}

const months = (n: number, dative = false) => (n === 1 ? '1 Monat' : `${n} ${dative ? 'Monaten' : 'Monate'}`);

const EMPTY = {
  name: '',
  kind: 'insurance' as Kind,
  provider: '',
  contractNumber: '',
  amount: '',
  interval: 'yearly' as Interval,
  startDate: '',
  termEnd: '',
  renewalMonths: '12',
  noticeMonths: '3',
  cancelledOn: '',
  notes: '',
  asFixedCost: false,
  firstDue: '',
  categoryId: '',
};
type Form = typeof EMPTY & { id?: string };

const formOf = (c: Contract): Form => ({
  id: c.id,
  name: c.name,
  kind: c.kind,
  provider: c.provider ?? '',
  contractNumber: c.contractNumber ?? '',
  amount: c.amount !== null ? String(c.amount).replace('.', ',') : '',
  interval: c.interval ?? 'yearly',
  startDate: c.startDate ?? '',
  termEnd: c.termEnd ?? '',
  renewalMonths: c.renewalMonths ? String(c.renewalMonths) : '',
  noticeMonths: String(c.noticeMonths),
  cancelledOn: c.cancelledOn ?? '',
  notes: c.notes ?? '',
  asFixedCost: !!c.recurringPaymentId,
  firstDue: '',
  categoryId: '',
});

// Versicherungen und Verträge: bis wann kündigen, was kostet es im Jahr;
// der Beitrag kann als Fixkosten in Vorschau und Jahresüberblick mitlaufen.
export function ContractsTab() {
  const [data, setData] = useState<ContractList | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(
    () =>
      api
        .get<ContractList>('/finance/contracts')
        .then(setData)
        .catch(() => setMessage({ ok: false, text: 'Verträge konnten nicht geladen werden.' })),
    [],
  );
  useEffect(() => {
    void load();
    api
      .get<Category[]>('/finance/categories')
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [load]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const amount = form.amount.trim() ? parseAmount(form.amount) : null;
    if (form.amount.trim() && (amount === null || amount <= 0)) {
      setMessage({ ok: false, text: 'Bitte einen gültigen Betrag eingeben.' });
      return;
    }
    const body = {
      name: form.name,
      kind: form.kind,
      provider: form.provider || null,
      contractNumber: form.contractNumber || null,
      amount,
      interval: amount !== null ? form.interval : null,
      startDate: form.startDate || null,
      termEnd: form.termEnd || null,
      renewalMonths: form.renewalMonths ? Number(form.renewalMonths) : null,
      noticeMonths: form.noticeMonths ? Number(form.noticeMonths) : 0,
      cancelledOn: form.cancelledOn || null,
      notes: form.notes || null,
      asFixedCost: form.asFixedCost,
      ...(form.firstDue ? { firstDue: form.firstDue } : {}),
      ...(form.categoryId ? { categoryId: form.categoryId } : {}),
    };
    try {
      if (form.id) await api.put(`/finance/contracts/${form.id}`, body);
      else await api.post('/finance/contracts', body);
      setMessage({ ok: true, text: `„${form.name}“ gespeichert.` });
      setForm(null);
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.' });
    }
  };

  const remove = async (c: Contract) => {
    if (
      !window.confirm(
        `„${c.name}“ löschen?${c.recurringPaymentId ? ' Die Fixkosten-Zeile wird mit gelöscht.' : ''}`,
      )
    )
      return;
    await api.delete(`/finance/contracts/${c.id}`).catch(() => undefined);
    await load();
  };

  const field = (key: keyof Form, label: string, props: Record<string, unknown> = {}) =>
    form && (
      <label className="field">
        <span>{label}</span>
        <input
          value={form[key] as string}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          data-testid={`contract-${key}`}
          {...props}
        />
      </label>
    );

  return (
    <section data-testid="contracts-tab">
      {message && (
        <p className={message.ok ? 'notice' : 'field-error'} data-testid="contracts-message">
          {message.text}
        </p>
      )}
      {data && (
        <>
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <div className="stat">
              <div className="stat-label">Kosten pro Jahr (laufende Verträge)</div>
              <div className="stat-value" data-testid="contracts-yearly">
                {formatEuro(data.summary.yearlyTotal)}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Kündigungsfrist in den nächsten 90 Tagen</div>
              <div className="stat-value" data-testid="contracts-notice-soon">
                {data.summary.noticeSoon}
              </div>
            </div>
          </div>
          <DonutChart
            title="Kosten pro Jahr nach Art"
            slices={Object.entries(data.summary.byKind).map(([kind, value]) => ({
              key: kind,
              label: KINDS[kind as Kind] ?? kind,
              value,
            }))}
            testId="contracts-donut"
          />
        </>
      )}

      {!form && (
        <button className="btn btn-primary" onClick={() => setForm({ ...EMPTY })} data-testid="contract-new">
          Vertrag oder Versicherung erfassen
        </button>
      )}
      {form && (
        <form
          className="card login-form"
          onSubmit={save}
          style={{ margin: '12px 0' }}
          data-testid="contract-form"
        >
          <strong>{form.id ? 'Vertrag bearbeiten' : 'Neuer Vertrag'}</strong>
          {field('name', 'Bezeichnung', {
            required: true,
            minLength: 2,
            placeholder: 'z.B. Betriebshaftpflicht',
          })}
          <label className="field">
            <span>Art</span>
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}
              data-testid="contract-kind"
            >
              {Object.entries(KINDS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {field('provider', 'Anbieter / Versicherer')}
          {field('contractNumber', 'Vertrags-/Versicherungsnummer')}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 140px' }}>
              {field('amount', 'Beitrag (€)', { inputMode: 'decimal' })}
            </div>
            <label className="field" style={{ flex: '1 1 140px' }}>
              <span>Rhythmus</span>
              <select
                value={form.interval}
                onChange={(e) => setForm({ ...form, interval: e.target.value as Interval })}
                data-testid="contract-interval"
              >
                {INTERVALS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 140px' }}>{field('startDate', 'Beginn', { type: 'date' })}</div>
            <div style={{ flex: '1 1 140px' }}>
              {field('termEnd', 'Ende der Laufzeit (leer = unbefristet)', { type: 'date' })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 140px' }}>
              {field('renewalMonths', 'verlängert sich um … Monate (leer = endet)', { inputMode: 'numeric' })}
            </div>
            <div style={{ flex: '1 1 140px' }}>
              {field('noticeMonths', 'Kündigungsfrist in Monaten', { inputMode: 'numeric' })}
            </div>
          </div>
          {form.id && field('cancelledOn', 'Gekündigt am', { type: 'date' })}
          {field('notes', 'Notiz')}
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={form.asFixedCost}
              onChange={(e) => setForm({ ...form, asFixedCost: e.target.checked })}
              data-testid="contract-fixed"
            />
            Beitrag als Fixkosten führen (Vorschau, Jahresüberblick)
          </label>
          {form.asFixedCost && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 140px' }}>
                {field('firstDue', 'nächste Abbuchung', { type: 'date' })}
              </div>
              <label className="field" style={{ flex: '1 1 140px' }}>
                <span>Kategorie</span>
                <select
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                >
                  <option value="">– unverändert/keine –</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" data-testid="contract-save">
              Speichern
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {data?.contracts.length === 0 && (
        <div className="empty-state" style={{ marginTop: 12 }}>
          Noch keine Verträge erfasst.
        </div>
      )}
      <div className="list" style={{ marginTop: 12 }}>
        {data?.contracts.map((c) => (
          <div
            key={c.id}
            className="list-item"
            style={{ flexWrap: 'wrap', gap: 8 }}
            data-testid="contract-item"
          >
            <div style={{ flex: '1 1 260px' }}>
              <div className="list-item-name">
                {c.name}
                {c.provider && <span className="list-item-meta"> · {c.provider}</span>}
              </div>
              <div className="list-item-meta">
                {KINDS[c.kind]}
                {c.contractNumber && ` · Nr. ${c.contractNumber}`}
                {c.amount !== null && c.interval && ` · ${formatEuro(c.amount)} ${intervalLabel(c.interval)}`}
                {c.yearly !== null && ` (${formatEuro(c.yearly)} im Jahr)`}
                {c.recurringPaymentId && ' · als Fixkosten'}
              </div>
              <div className="list-item-meta" data-testid="contract-terms">
                {c.endsOn && `${c.state === 'expired' ? 'beendet am' : 'Laufzeit bis'} ${day(c.endsOn)}`}
                {c.noticeDeadline &&
                  ` · kündigen bis ${day(c.noticeDeadline)} (noch ${c.daysToDeadline} Tage, ${months(c.noticeMonths)} Frist)`}
                {c.state === 'open_ended' && `jederzeit mit ${months(c.noticeMonths, true)} Frist kündbar`}
                {c.cancelledOn && ` · gekündigt am ${day(c.cancelledOn)}`}
              </div>
            </div>
            <span className={`status-badge ${STATE[c.state].badge}`} data-testid="contract-state">
              {STATE[c.state].label}
            </span>
            <div className="btn-row">
              <button className="btn btn-sm" onClick={() => setForm(formOf(c))} data-testid="contract-edit">
                Bearbeiten
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => void remove(c)}>
                Löschen
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
