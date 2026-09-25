import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { formatEuro, parseAmount } from '../../format';
import { useAiTask } from '../../ai/tasks';
import { useAuth } from '../../auth/AuthContext';
import { Category, day } from './shared';

type Status = 'open' | 'paid' | 'cancelled';
type Reason = 'amount' | 'discount' | 'number' | 'iban' | 'name';

interface Payable {
  id: string;
  supplierName: string;
  supplierIban: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  amount: string;
  netAmount: string | null;
  vatAmount: string | null;
  discountPercent: string | null;
  discountUntil: string | null;
  discountedAmount: string | null;
  category: { id: string; name: string } | null;
  document: { id: string; fileName: string } | null;
  project: { id: string; number: string | null; title: string } | null;
  source: 'manual' | 'text' | 'einvoice';
  status: Status;
  paidAt: string | null;
  paidAmount: string | null;
  bankTransactionId: string | null;
  notes: string | null;
  plan: { date: string; amount: string; withDiscount: boolean; overdue: boolean } | null;
  match: {
    transactionId: string;
    bookingDate: string;
    amount: string;
    counterpartyName: string | null;
    reasons: Reason[];
  } | null;
}

interface Draft {
  supplierName: string | null;
  supplierIban: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  amount: string | null;
  netAmount: string | null;
  vatAmount: string | null;
  discountPercent: string | null;
  discountUntil: string | null;
  categoryId: string | null;
}

interface Extracted {
  documentId: string;
  fileName: string;
  source: 'einvoice' | 'text' | 'manual';
  draft: Draft;
  candidates: { supplierName: string[]; amount: string[]; invoiceNumber: string[]; iban: string[] };
  duplicateOf: Payable | null;
  warning: string | null;
}

interface Form {
  id?: string;
  documentId?: string;
  fileName?: string;
  source: 'einvoice' | 'text' | 'manual';
  supplierName: string;
  supplierIban: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amount: string;
  netAmount: string;
  vatAmount: string;
  discountPercent: string;
  discountUntil: string;
  categoryId: string;
  projectId: string;
  notes: string;
}

interface ProjectOption {
  id: string;
  number: string | null;
  title: string;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
}
const projectLabel = (p: { number: string | null; title: string }) =>
  p.number ? `${p.number} · ${p.title}` : p.title;

const EMPTY: Form = {
  source: 'manual',
  supplierName: '',
  supplierIban: '',
  invoiceNumber: '',
  invoiceDate: '',
  dueDate: '',
  amount: '',
  netAmount: '',
  vatAmount: '',
  discountPercent: '',
  discountUntil: '',
  categoryId: '',
  projectId: '',
  notes: '',
};
const TABS: { status: Status; label: string }[] = [
  { status: 'open', label: 'Offen' },
  { status: 'paid', label: 'Bezahlt' },
  { status: 'cancelled', label: 'Storniert' },
];
const REASONS: Record<Reason, string> = {
  amount: 'Betrag',
  discount: 'Betrag mit Skonto',
  number: 'Rechnungsnummer',
  iban: 'IBAN',
  name: 'Name',
};
// "1234.5" -> "1234,50"
const amountText = (value: string | null) => (value ? Number(value).toFixed(2).replace('.', ',') : '');
const percentText = (value: string | null) => (value ? String(Number(value)).replace('.', ',') : '');

// Eingangsrechnungen: Beleg einlesen (E-Rechnung exakt, PDF/Foto per
// Texterkennung als Vorschlag), prüfen, erfassen; bezahlt über die passende
// Abbuchung aus dem Kontoauszug oder von Hand
export function PayablesTab() {
  const [status, setStatus] = useState<Status>('open');
  const [items, setItems] = useState<Payable[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  // ?projekt=<id>: nur die Eingangsrechnungen dieses Projekts (Link aus der Nachkalkulation)
  const [params, setParams] = useSearchParams();
  const projectFilter = params.get('projekt');
  const [form, setForm] = useState<Form | null>(null);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  // weitere Aktionen einer Zeile (Beleg, Stornieren, Löschen)
  const [more, setMore] = useState<string | null>(null);
  const [manualPay, setManualPay] = useState<{ id: string; paidAt: string; amount: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { hasPermission } = useAuth();
  const aiRead = useAiTask('beleg_lesen') && hasPermission('ai.use');
  const latest = useRef(0);

  const load = useCallback(() => {
    const requestId = ++latest.current;
    return api
      .get<Payable[]>(
        `/finance/payables?status=${status}${projectFilter ? `&projectId=${encodeURIComponent(projectFilter)}` : ''}`,
      )
      .then((list) => requestId === latest.current && setItems(list))
      .catch((err) => {
        if (requestId === latest.current)
          setError(
            err instanceof ApiError ? err.message : 'Eingangsrechnungen konnten nicht geladen werden.',
          );
      });
  }, [status, projectFilter]);

  useEffect(() => {
    load();
  }, [load]);
  // nach einer Aktion mit dem aktuellen Reiter neu laden (auch wenn er
  // während der Aktion gewechselt wurde)
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    api
      .get<Category[]>('/finance/categories')
      .then(setCategories)
      .catch(() => setCategories([]));
    // Projekte zum Zuordnen (ohne Recht "Kunden lesen" bleibt die Auswahl leer)
    api
      .get<ProjectOption[]>('/projects?take=500')
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  const run = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
      await loadRef.current();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    run(async () => {
      const result = await api.upload<Extracted>('/finance/payables/extract', file);
      const d = result.draft;
      setExtracted(result);
      setForm({
        documentId: result.documentId,
        fileName: result.fileName,
        source: result.source,
        supplierName: d.supplierName ?? '',
        supplierIban: d.supplierIban ?? '',
        invoiceNumber: d.invoiceNumber ?? '',
        invoiceDate: d.invoiceDate ?? '',
        dueDate: d.dueDate ?? '',
        amount: amountText(d.amount),
        netAmount: amountText(d.netAmount),
        vatAmount: amountText(d.vatAmount),
        discountPercent: percentText(d.discountPercent),
        discountUntil: d.discountUntil ?? '',
        categoryId: d.categoryId ?? '',
        projectId: projectFilter ?? '',
        notes: '',
      });
    });
  };

  const close = () => {
    setForm(null);
    setExtracted(null);
  };

  // Beleg von der KI lesen lassen: erkannte Werte ersetzen die Vorschläge,
  // leere Antworten lassen das Feld wie es ist
  const readWithAi = () => {
    const documentId = form?.documentId;
    if (!documentId) return;
    void run(async () => {
      const result = await api.post<{
        draft: Draft;
        duplicateOf: Payable | null;
        providerName: string;
        readable: boolean;
      }>(`/finance/payables/documents/${documentId}/ai-read`);
      const d = result.draft;
      setForm((current) =>
        current
          ? {
              ...current,
              supplierName: d.supplierName ?? current.supplierName,
              supplierIban: d.supplierIban ?? current.supplierIban,
              invoiceNumber: d.invoiceNumber ?? current.invoiceNumber,
              invoiceDate: d.invoiceDate ?? current.invoiceDate,
              dueDate: d.dueDate ?? current.dueDate,
              amount: d.amount ? amountText(d.amount) : current.amount,
              netAmount: d.netAmount ? amountText(d.netAmount) : current.netAmount,
              vatAmount: d.vatAmount ? amountText(d.vatAmount) : current.vatAmount,
              discountPercent: d.discountPercent ? percentText(d.discountPercent) : current.discountPercent,
              discountUntil: d.discountUntil ?? current.discountUntil,
              categoryId: current.categoryId || (d.categoryId ?? ''),
            }
          : current,
      );
      setExtracted((current) =>
        current ? { ...current, duplicateOf: result.duplicateOf, warning: null } : current,
      );
      return result.readable
        ? `Von der KI gelesen (${result.providerName}) – bitte prüfen.`
        : 'Die KI konnte auf dem Beleg nichts erkennen.';
    });
  };

  // eingelesenen Beleg nicht erfassen: Datei wieder entfernen
  const discard = () => {
    const documentId = form?.documentId;
    close();
    if (documentId && !form?.id)
      run(async () => {
        await api.delete(`/finance/payables/documents/${documentId}`);
      });
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const amount = parseAmount(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Bitte einen gültigen Betrag angeben.');
      return;
    }
    // optionale Beträge: leer = keiner
    const optional = (value: string) => (value.trim() ? parseAmount(value) : null);
    const netAmount = optional(form.netAmount);
    const vatAmount = optional(form.vatAmount);
    if ([netAmount, vatAmount].some((v) => v !== null && (!Number.isFinite(v) || v < 0))) {
      setError('Bitte gültige Beträge für Netto und USt angeben.');
      return;
    }
    const percent = form.discountPercent ? parseAmount(form.discountPercent) : null;
    if (percent !== null && (!Number.isFinite(percent) || percent <= 0 || percent > 20)) {
      setError('Skonto bitte zwischen 0 und 20 % angeben.');
      return;
    }
    const body = {
      supplierName: form.supplierName.trim(),
      supplierIban: form.supplierIban.trim() || null,
      invoiceNumber: form.invoiceNumber.trim() || null,
      invoiceDate: form.invoiceDate || null,
      dueDate: form.dueDate || null,
      amount,
      netAmount,
      vatAmount,
      discountPercent: percent,
      discountUntil: percent ? form.discountUntil || null : null,
      categoryId: form.categoryId || null,
      projectId: form.projectId || null,
      notes: form.notes.trim() || null,
      ...(form.id ? {} : { documentId: form.documentId, source: form.source }),
    };
    run(async () => {
      if (form.id) await api.patch(`/finance/payables/${form.id}`, body);
      else await api.post('/finance/payables', body);
      close();
      return form.id ? 'Gespeichert.' : `Rechnung von ${body.supplierName} erfasst.`;
    });
  };

  const edit = (p: Payable) => {
    setExtracted(null);
    setForm({
      id: p.id,
      source: p.source,
      fileName: p.document?.fileName,
      supplierName: p.supplierName,
      supplierIban: p.supplierIban ?? '',
      invoiceNumber: p.invoiceNumber ?? '',
      invoiceDate: p.invoiceDate ?? '',
      dueDate: p.dueDate ?? '',
      amount: amountText(p.amount),
      netAmount: amountText(p.netAmount),
      vatAmount: amountText(p.vatAmount),
      discountPercent: percentText(p.discountPercent),
      discountUntil: p.discountUntil ?? '',
      categoryId: p.category?.id ?? '',
      projectId: p.project?.id ?? '',
      notes: p.notes ?? '',
    });
  };

  const payManually = (event: FormEvent) => {
    event.preventDefault();
    if (!manualPay) return;
    const amount = manualPay.amount ? parseAmount(manualPay.amount) : undefined;
    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
      setError('Bitte einen gültigen Betrag angeben.');
      return;
    }
    run(async () => {
      await api.post(`/finance/payables/${manualPay.id}/pay`, { paidAt: manualPay.paidAt, amount });
      setManualPay(null);
      return 'Als bezahlt verbucht.';
    });
  };

  const field = (key: keyof Form) => ({
    value: form ? (form[key] ?? '') : '',
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      form && setForm({ ...form, [key]: e.target.value }),
  });
  // Vorschläge zum Anklicken, wenn der Text mehrere Treffer hatte
  const chips = (values: string[] | undefined, key: keyof Form, show: (v: string) => string = (v) => v) => {
    const list = (values ?? []).filter((v) => show(v) !== form?.[key]);
    if (!form || list.length === 0) return null;
    return (
      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
        {list.map((v) => (
          <button
            key={v}
            type="button"
            className="status-badge"
            style={{ cursor: 'pointer', border: 'none' }}
            onClick={() => setForm({ ...form, [key]: show(v) })}
            data-testid={`payable-candidate-${key}`}
          >
            {show(v)}
          </button>
        ))}
      </span>
    );
  };

  const openTotal = (items ?? []).reduce((sum, p) => sum + Number(p.plan?.amount ?? 0), 0);
  const saving = (items ?? [])
    .filter((p) => p.plan?.withDiscount)
    .reduce((sum, p) => sum + Number(p.amount) - Number(p.plan!.amount), 0);

  return (
    <section>
      <p className="list-item-meta">
        Rechnungen von Lieferanten: E-Rechnungen (XRechnung, ZUGFeRD) werden exakt übernommen, bei PDFs und
        Fotos schlägt die Texterkennung die Angaben vor. Nach dem Einlesen eines Kontoauszugs werden
        eindeutige Zahlungen (Betrag und Rechnungsnummer) automatisch verbucht.
      </p>
      {error && <p className="field-error">{error}</p>}
      {notice && (
        <p className="list-item-meta" data-testid="payable-notice">
          {notice}
        </p>
      )}

      {form ? (
        <form
          onSubmit={save}
          className="job-card"
          style={{ display: 'block', margin: '12px 0' }}
          data-testid="payable-form"
        >
          <h3 style={{ marginTop: 0 }}>
            {form.id ? 'Eingangsrechnung bearbeiten' : 'Eingangsrechnung erfassen'}
          </h3>
          {form.fileName && (
            <p className="list-item-meta" data-testid="payable-source">
              Beleg: {form.fileName} ·{' '}
              {form.source === 'einvoice'
                ? 'E-Rechnung – Angaben exakt übernommen'
                : form.source === 'text'
                  ? 'aus dem Text erkannt – bitte prüfen'
                  : 'Angaben von Hand'}
            </p>
          )}
          {aiRead && form.documentId && form.source !== 'einvoice' && (
            <div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={readWithAi}
                disabled={busy}
                data-testid="payable-ai-read"
              >
                {busy ? 'Liest …' : 'Mit KI lesen'}
              </button>
            </div>
          )}
          {extracted?.warning && <p className="field-error">{extracted.warning}</p>}
          {extracted?.duplicateOf && (
            <p className="field-error" data-testid="payable-duplicate">
              Achtung: Die Rechnung {extracted.duplicateOf.invoiceNumber} von{' '}
              {extracted.duplicateOf.supplierName} ist schon erfasst (
              {formatEuro(extracted.duplicateOf.amount)}).
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: '2 1 240px' }}>
              <span>Lieferant</span>
              <input
                {...field('supplierName')}
                required
                minLength={2}
                maxLength={140}
                data-testid="payable-supplier"
              />
              {chips(extracted?.candidates.supplierName, 'supplierName')}
            </label>
            <label className="field" style={{ flex: '1 1 150px' }}>
              <span>Rechnungsnummer</span>
              <input {...field('invoiceNumber')} maxLength={60} data-testid="payable-number" />
              {chips(extracted?.candidates.invoiceNumber, 'invoiceNumber')}
            </label>
            <label className="field" style={{ flex: '1 1 130px' }}>
              <span>Betrag brutto (€)</span>
              <input {...field('amount')} inputMode="decimal" required data-testid="payable-amount" />
              {chips(extracted?.candidates.amount, 'amount', amountText)}
            </label>
            <label className="field" style={{ flex: '1 1 110px' }}>
              <span>davon netto (€)</span>
              <input {...field('netAmount')} inputMode="decimal" data-testid="payable-net" />
            </label>
            <label className="field" style={{ flex: '1 1 110px' }}>
              <span>USt (€)</span>
              <input {...field('vatAmount')} inputMode="decimal" data-testid="payable-vat" />
            </label>
            <label className="field" style={{ flex: '1 1 150px' }}>
              <span>Rechnungsdatum</span>
              <input type="date" {...field('invoiceDate')} data-testid="payable-date" />
            </label>
            <label className="field" style={{ flex: '1 1 150px' }}>
              <span>Fällig am</span>
              <input type="date" {...field('dueDate')} data-testid="payable-due" />
            </label>
            <label className="field" style={{ flex: '1 1 110px' }}>
              <span>Skonto (%)</span>
              <input {...field('discountPercent')} inputMode="decimal" data-testid="payable-discount" />
            </label>
            <label className="field" style={{ flex: '1 1 150px' }}>
              <span>Skonto bis</span>
              <input type="date" {...field('discountUntil')} data-testid="payable-discount-until" />
            </label>
            <label className="field" style={{ flex: '1 1 160px' }}>
              <span>Kategorie</span>
              <select {...field('categoryId')} data-testid="payable-category">
                <option value="">– ohne –</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {projects.length > 0 && (
              <label className="field" style={{ flex: '2 1 240px' }}>
                <span>Projekt (Einkauf/Fremdleistung)</span>
                <select {...field('projectId')} data-testid="payable-project">
                  <option value="">– keinem Projekt –</option>
                  {projects
                    // abgeschlossene nur, wenn schon zugeordnet
                    .filter(
                      (p) => p.status === 'open' || p.status === 'in_progress' || p.id === form.projectId,
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {projectLabel(p)}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label className="field" style={{ flex: '2 1 240px' }}>
              <span>IBAN des Lieferanten</span>
              <input {...field('supplierIban')} maxLength={40} />
              {chips(extracted?.candidates.iban, 'supplierIban')}
            </label>
            <label className="field" style={{ flex: '2 1 240px' }}>
              <span>Notiz</span>
              <input {...field('notes')} maxLength={500} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary" disabled={busy} data-testid="payable-save">
              Speichern
            </button>
            <button type="button" className="btn" onClick={discard} data-testid="payable-discard">
              {form.documentId && !form.id ? 'Verwerfen' : 'Abbrechen'}
            </button>
          </div>
        </form>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 12px' }}>
          <label className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center' }}>
            {busy ? 'Liest …' : 'Beleg einlesen'}
            <input
              type="file"
              accept=".pdf,.xml,application/pdf,application/xml,text/xml,image/jpeg,image/png"
              onChange={upload}
              disabled={busy}
              style={{ display: 'none' }}
              data-testid="payable-upload"
            />
          </label>
          <button
            className="btn"
            onClick={() =>
              setForm({
                ...EMPTY,
                invoiceDate: new Date().toLocaleDateString('sv-SE'),
                projectId: projectFilter ?? '',
              })
            }
            data-testid="payable-new"
          >
            Ohne Beleg erfassen
          </button>
        </div>
      )}

      <div className="tab-bar" style={{ marginBottom: 12 }}>
        {TABS.map((t) => (
          <button
            key={t.status}
            className={status === t.status ? 'active' : ''}
            onClick={() => {
              if (t.status === status) return;
              setItems(null);
              setStatus(t.status);
            }}
            data-testid={`payable-tab-${t.status}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {projectFilter && (
        <p className="list-item-meta" data-testid="payable-project-filter">
          Nur Projekt{' '}
          {(() => {
            const p = projects.find((x) => x.id === projectFilter);
            return p ? projectLabel(p) : '';
          })()}{' '}
          ·{' '}
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete('projekt');
              setParams(next, { replace: true });
            }}
          >
            alle anzeigen
          </button>
        </p>
      )}
      {status === 'open' && items && items.length > 0 && (
        <p className="list-item-meta" data-testid="payable-summary">
          {items.length} offen · {formatEuro(openTotal)} zu zahlen
          {saving > 0 && ` · ${formatEuro(saving)} Ersparnis bei Zahlung mit Skonto`}
        </p>
      )}
      {items === null && !error && <p>Lädt …</p>}
      {items?.length === 0 && <p className="list-item-meta">Keine Eingangsrechnungen.</p>}
      {items?.map((p) => (
        <div
          key={p.id}
          className="list-item"
          style={{ display: 'block' }}
          data-testid="payable"
          data-id={p.id}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div className="list-item-name">
                {p.supplierName}
                {p.invoiceNumber && ` · ${p.invoiceNumber}`}
              </div>
              <div className="list-item-meta">
                {[
                  p.invoiceDate && `vom ${day(p.invoiceDate)}`,
                  p.dueDate && `fällig ${day(p.dueDate)}`,
                  p.category?.name,
                  p.source === 'einvoice' && 'E-Rechnung',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {p.project && (
                  <>
                    {' · '}
                    <Link to={`/projekte/${p.project.id}`} data-testid="payable-project-link">
                      {projectLabel(p.project)}
                    </Link>
                  </>
                )}
              </div>
              {p.status === 'open' && p.plan && (
                <div
                  className="list-item-meta"
                  style={p.plan.withDiscount || p.plan.overdue ? { color: 'var(--color-ink)' } : undefined}
                  data-testid="payable-plan"
                >
                  {p.plan.withDiscount
                    ? `Mit ${percentText(p.discountPercent)} % Skonto bis ${day(p.plan.date)}: ${formatEuro(p.plan.amount)}`
                    : p.plan.overdue
                      ? `⚠ überfällig seit ${day(p.dueDate ?? p.invoiceDate ?? p.plan.date)}`
                      : `zahlen bis ${day(p.plan.date)}`}
                </div>
              )}
              {p.status === 'paid' && (
                <div className="list-item-meta" data-testid="payable-paid">
                  bezahlt am {day(p.paidAt!)}: {formatEuro(p.paidAmount!)}
                  {p.bankTransactionId ? ' (laut Kontoauszug)' : ' (von Hand)'}
                </div>
              )}
            </div>
            <strong style={{ whiteSpace: 'nowrap' }}>{formatEuro(p.amount)}</strong>
          </div>
          {p.status === 'open' && p.match && (
            <div
              className="job-card"
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                alignItems: 'center',
                margin: '8px 0',
                padding: '8px 12px',
              }}
              data-testid="payable-match"
            >
              <span style={{ flex: '1 1 220px' }}>
                Passende Abbuchung: {day(p.match.bookingDate)} · {formatEuro(p.match.amount)} ·{' '}
                {p.match.counterpartyName ?? 'Unbekannt'}
                <span className="list-item-meta">
                  {' '}
                  (gleich: {p.match.reasons.map((r) => REASONS[r]).join(', ')})
                </span>
              </span>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.post(`/finance/payables/${p.id}/pay`, {
                      bankTransactionId: p.match!.transactionId,
                    });
                    return `${p.supplierName}: als bezahlt verbucht.`;
                  })
                }
                data-testid="payable-pay-match"
              >
                Als bezahlt verbuchen
              </button>
            </div>
          )}
          {manualPay?.id === p.id && (
            <form
              onSubmit={payManually}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', margin: '8px 0' }}
            >
              <label className="field">
                <span>Bezahlt am</span>
                <input
                  type="date"
                  value={manualPay.paidAt}
                  onChange={(e) => setManualPay({ ...manualPay, paidAt: e.target.value })}
                  required
                />
              </label>
              <label className="field" style={{ flex: '0 1 140px' }}>
                <span>Betrag (€)</span>
                <input
                  value={manualPay.amount}
                  onChange={(e) => setManualPay({ ...manualPay, amount: e.target.value })}
                  inputMode="decimal"
                  placeholder="automatisch"
                />
              </label>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy}
                data-testid="payable-pay-manual-save"
              >
                Verbuchen
              </button>
              <button type="button" className="btn" onClick={() => setManualPay(null)}>
                Abbrechen
              </button>
            </form>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            {p.status === 'open' && manualPay?.id !== p.id && (
              <button
                className="btn"
                onClick={() =>
                  setManualPay({ id: p.id, paidAt: new Date().toLocaleDateString('sv-SE'), amount: '' })
                }
                data-testid="payable-pay-manual"
              >
                Bezahlt ohne Kontoauszug
              </button>
            )}
            {p.status !== 'paid' && (
              <button className="btn" onClick={() => edit(p)} data-testid="payable-edit">
                Bearbeiten
              </button>
            )}
            {p.status !== 'open' && (
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.post(`/finance/payables/${p.id}/reopen`);
                    return 'Wieder offen.';
                  })
                }
                data-testid="payable-reopen"
              >
                Wieder öffnen
              </button>
            )}
            {more !== p.id ? (
              <button
                className="btn"
                onClick={() => setMore(p.id)}
                aria-label="Weitere Aktionen"
                data-testid="payable-more"
              >
                Mehr …
              </button>
            ) : (
              <>
                {p.document && (
                  <button
                    className="btn"
                    onClick={() =>
                      run(() => api.downloadFile(`/finance/payables/${p.id}/file`, p.document!.fileName))
                    }
                  >
                    Beleg
                  </button>
                )}
                {p.status === 'open' && (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Rechnung von ${p.supplierName} stornieren (wird nicht bezahlt)?`))
                        run(async () => {
                          await api.post(`/finance/payables/${p.id}/cancel`);
                        });
                    }}
                  >
                    Stornieren
                  </button>
                )}
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Rechnung von ${p.supplierName} samt Beleg löschen?`))
                      run(async () => {
                        await api.delete(`/finance/payables/${p.id}`);
                      });
                  }}
                  data-testid="payable-delete"
                >
                  Löschen
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
