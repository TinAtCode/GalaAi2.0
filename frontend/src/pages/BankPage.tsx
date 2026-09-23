import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { formatEuro, parseAmount } from '../format';

type Status = 'open' | 'booked' | 'ignored';

interface BankTransaction {
  id: string;
  bookingDate: string; // JJJJ-MM-TT
  amount: string;
  debtorName: string | null;
  debtorIban: string | null;
  remittance: string | null;
  status: Status;
  booked: string; // bereits auf Rechnungen verteilt
  rest: string; // noch zu verteilen
  payments: { id: string; amount: string; invoiceId: string; number: string }[];
  suggestion: {
    invoiceId: string;
    number: string;
    open: string;
    customer: string;
    reason: 'reference' | 'amount';
  } | null;
}

interface OpenItem {
  invoiceId: string;
  number: string;
  open: string;
  customer: { name: string };
}

interface ImportResult {
  imported: number;
  duplicates: number;
  skipped: { debits: number; notBooked: number; foreignCurrency: number };
}

const TABS: { status: Status; label: string }[] = [
  { status: 'open', label: 'Offen' },
  { status: 'booked', label: 'Gebucht' },
  { status: 'ignored', label: 'Ignoriert' },
];

const day = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');
const cents = (value: string | number) => Math.round(Number(value) * 100);
// Betrag im Eingabefeld: "1234,50"
const amountText = (value: number) => (value / 100).toFixed(2).replace('.', ',');

// Bankabgleich: Kontoauszug (CAMT.053 aus dem Online-Banking) einlesen,
// Zahlungseingänge einer offenen Rechnung zuordnen und buchen.
export function BankPage() {
  const [status, setStatus] = useState<Status>('open');
  const [transactions, setTransactions] = useState<BankTransaction[] | null>(null);
  const [openItems, setOpenItems] = useState<OpenItem[]>([]);
  // Auswahl je Umsatz: Rechnung und Betrag
  const [choice, setChoice] = useState<Record<string, { invoiceId: string; amount: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // nur die Antwort der zuletzt gestarteten Abfrage übernehmen (Reiterwechsel)
  const latestLoad = useRef(0);

  const load = useCallback(() => {
    const requestId = ++latestLoad.current;
    return Promise.all([
      api.get<BankTransaction[]>(`/bank/transactions?status=${status}`),
      status === 'open' ? api.get<OpenItem[]>('/open-items') : Promise.resolve([]),
    ])
      .then(([list, items]) => {
        if (requestId !== latestLoad.current) return;
        setTransactions(list);
        setOpenItems(items);
        setChoice({});
      })
      .catch((err) => {
        if (requestId !== latestLoad.current) return;
        setError(err instanceof ApiError ? err.message : 'Bankumsätze konnten nicht geladen werden.');
      });
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  // reload=false, wenn ein Reiterwechsel ohnehin neu lädt
  const run = async (action: () => Promise<string | void>, reload = true) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
      if (reload) await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const importFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    // Nach dem Einlesen den Reiter "Offen" zeigen; ein Wechsel lädt dort neu
    const switchTab = status !== 'open';
    run(async () => {
      const result = await api.upload<ImportResult>('/bank/import', file);
      const { debits, notBooked, foreignCurrency } = result.skipped;
      const skipped = [
        debits && `${debits} ${debits === 1 ? 'Abbuchung' : 'Abbuchungen'}`,
        notBooked && `${notBooked} vorgemerkt`,
        foreignCurrency && `${foreignCurrency} Fremdwährung`,
      ].filter(Boolean);
      if (switchTab) {
        setTransactions(null);
        setStatus('open');
      }
      return (
        `${result.imported} ${result.imported === 1 ? 'Zahlungseingang' : 'Zahlungseingänge'} eingelesen` +
        (result.duplicates ? `, ${result.duplicates} schon vorhanden` : '') +
        (skipped.length ? ` – übersprungen: ${skipped.join(', ')}` : '') +
        '.'
      );
    }, !switchTab);
  };

  // Vorbelegung des Betrags: Rest des Umsatzes, höchstens der offene Betrag der Rechnung
  const defaultAmount = (t: BankTransaction, invoice?: OpenItem) =>
    amountText(invoice ? Math.min(cents(t.rest), cents(invoice.open)) : cents(t.rest));

  // Vorauswahl: vorgeschlagene Rechnung
  const selected = (t: BankTransaction) => {
    const invoiceId = choice[t.id]?.invoiceId ?? t.suggestion?.invoiceId ?? '';
    const invoice = openItems.find((i) => i.invoiceId === invoiceId);
    const amount = choice[t.id]?.amount ?? defaultAmount(t, invoice);
    return { invoiceId, invoice, amount };
  };

  const book = (t: BankTransaction) => {
    const { invoiceId, invoice, amount } = selected(t);
    const value = parseAmount(amount);
    if (!invoice) {
      setError('Bitte eine Rechnung auswählen.');
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      setError('Bitte einen gültigen Betrag angeben.');
      return;
    }
    run(async () => {
      await api.post(`/bank/transactions/${t.id}/book`, { invoiceId, amount: value });
      return `${formatEuro(value)} auf ${invoice.number} gebucht.`;
    });
  };

  const setField = (t: BankTransaction, patch: Partial<{ invoiceId: string; amount: string }>) => {
    const current = selected(t);
    const next = { invoiceId: current.invoiceId, amount: current.amount, ...patch };
    // neue Rechnung gewählt: Betrag neu vorbelegen
    if (patch.invoiceId !== undefined && patch.amount === undefined) {
      next.amount = defaultAmount(
        t,
        openItems.find((i) => i.invoiceId === patch.invoiceId),
      );
    }
    setChoice({ ...choice, [t.id]: next });
  };

  return (
    <div>
      <header className="my-day-header">
        <h2>Bankabgleich</h2>
      </header>
      <p className="list-item-meta">
        Kontoauszug im Format CAMT.053 (XML) aus dem Online-Banking einlesen. Zahlungseingänge mit
        Rechnungsnummer im Verwendungszweck werden der Rechnung zugeordnet; gebucht wird erst nach
        Bestätigung.
      </p>
      <label className="btn btn-primary" style={{ display: 'inline-block', margin: '8px 0 16px' }}>
        Kontoauszug einlesen
        <input
          type="file"
          accept=".xml,application/xml,text/xml"
          onChange={importFile}
          disabled={busy}
          style={{ display: 'none' }}
          data-testid="bank-import"
        />
      </label>
      {error && <p className="field-error">{error}</p>}
      {notice && (
        <p className="list-item-meta" data-testid="bank-notice">
          {notice}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {TABS.map((tab) => (
          <button
            key={tab.status}
            className={`btn${tab.status === status ? ' btn-primary' : ''}`}
            onClick={() => {
              if (tab.status === status) return;
              setTransactions(null);
              setStatus(tab.status);
            }}
            data-testid={`bank-tab-${tab.status}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {transactions === null && !error && <p>Lädt …</p>}
      {transactions?.length === 0 && (
        <div className="empty-state">
          <strong>Keine Umsätze.</strong>
          {status === 'open' && 'Alle eingelesenen Zahlungseingänge sind zugeordnet.'}
        </div>
      )}
      {transactions?.map((t) => {
        const { invoiceId, invoice, amount } = selected(t);
        return (
          <div key={t.id} className="list-item" data-testid="bank-transaction" data-id={t.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="list-item-name">
                {formatEuro(t.amount)} · {t.debtorName ?? 'Unbekannt'}
              </div>
              <div className="list-item-meta">
                {day(t.bookingDate)}
                {t.debtorIban && ` · ${t.debtorIban}`}
                {t.remittance && ` · ${t.remittance}`}
              </div>
              {t.payments.length > 0 && (
                <div className="list-item-meta" data-testid="bank-payments">
                  Gebucht: {t.payments.map((p) => `${formatEuro(p.amount)} auf ${p.number}`).join(', ')}
                  {cents(t.rest) > 0 && ` · Rest ${formatEuro(t.rest)}`}
                  {t.status === 'ignored' && cents(t.rest) > 0 && ' (ignoriert)'}
                </div>
              )}
              {t.status === 'open' && t.suggestion && (
                <div className="list-item-meta" data-testid="bank-suggestion">
                  Vorschlag: {t.suggestion.number} ({t.suggestion.customer}, offen{' '}
                  {formatEuro(t.suggestion.open)}) –{' '}
                  {t.suggestion.reason === 'reference'
                    ? 'Rechnungsnummer im Verwendungszweck'
                    : 'gleicher Betrag, bitte prüfen'}
                </div>
              )}
              {t.status === 'open' && (
                <div
                  style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 6 }}
                >
                  <label className="field" style={{ flex: '2 1 220px' }}>
                    <span>Rechnung</span>
                    <select
                      value={invoiceId}
                      onChange={(e) => setField(t, { invoiceId: e.target.value })}
                      data-testid="bank-invoice"
                    >
                      <option value="">– auswählen –</option>
                      {openItems.map((i) => (
                        <option key={i.invoiceId} value={i.invoiceId}>
                          {i.number} · {i.customer.name} · offen {formatEuro(i.open)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field" style={{ flex: '1 1 110px' }}>
                    <span>Betrag (€)</span>
                    <input
                      value={amount}
                      onChange={(e) => setField(t, { amount: e.target.value })}
                      inputMode="decimal"
                      data-testid="bank-amount"
                    />
                  </label>
                  <button
                    className="btn btn-primary"
                    disabled={busy || !invoice}
                    onClick={() => book(t)}
                    data-testid="bank-book"
                  >
                    Buchen
                  </button>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.post(`/bank/transactions/${t.id}/ignore`);
                      })
                    }
                    data-testid="bank-ignore"
                  >
                    {t.payments.length > 0 ? 'Rest ignorieren' : 'Ignorieren'}
                  </button>
                </div>
              )}
              {t.status === 'open' && invoice && cents(t.rest) > cents(invoice.open) && (
                <div className="list-item-meta">
                  {formatEuro((cents(t.rest) - cents(invoice.open)) / 100)} mehr als bei {invoice.number}{' '}
                  offen – den Rest einer weiteren Rechnung zuordnen oder, bei einer Überzahlung, nach Klärung
                  mit dem Kunden ignorieren.
                </div>
              )}
            </div>
            {t.status === 'booked' && <span className="status-badge">gebucht</span>}
            {t.status === 'ignored' && (
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.post(`/bank/transactions/${t.id}/reopen`);
                  })
                }
                data-testid="bank-reopen"
              >
                Wieder öffnen
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
