import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

type Chart = 'SKR03' | 'SKR04';
type AccountKey =
  | 'standard19'
  | 'standard7'
  | 'smallBusiness'
  | 'reverseCharge'
  | 'bank'
  | 'cash'
  | 'other'
  | 'dunningCosts'
  | 'interest';

interface DatevSettings {
  datevConsultantNumber: number | null;
  datevClientNumber: number | null;
  datevChartOfAccounts: Chart;
  datevRevenueAccounts: Partial<Record<AccountKey, number>> | null;
}

// Standardkonten wie im Backend (datev/revenue-accounts.ts) – nur als Anzeige
const DEFAULT_ACCOUNTS: Record<Chart, Record<AccountKey, number>> = {
  SKR03: {
    standard19: 8400,
    standard7: 8300,
    smallBusiness: 8195,
    reverseCharge: 8337,
    bank: 1200,
    cash: 1000,
    other: 1360,
    dunningCosts: 2700,
    interest: 2650,
  },
  SKR04: {
    standard19: 4400,
    standard7: 4300,
    smallBusiness: 4185,
    reverseCharge: 4337,
    bank: 1800,
    cash: 1600,
    other: 1460,
    dunningCosts: 4830,
    interest: 7100,
  },
};

const ACCOUNT_LABELS: { key: AccountKey; label: string }[] = [
  { key: 'standard19', label: 'Erlöse 19 %' },
  { key: 'standard7', label: 'Erlöse 7 %' },
  { key: 'smallBusiness', label: 'Erlöse Kleinunternehmer (§ 19)' },
  { key: 'reverseCharge', label: 'Erlöse § 13b' },
  { key: 'bank', label: 'Bank (Zahlungseingänge)' },
  { key: 'cash', label: 'Kasse (Barzahlungen)' },
  { key: 'other', label: 'Geldtransit (sonstige Zahlungen)' },
  { key: 'dunningCosts', label: 'Mahnkosten (Gebühren, Pauschale)' },
  { key: 'interest', label: 'Verzugszinsen' },
];

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Vormonat: der übliche Zeitraum für die Buchhaltung
function previousMonth() {
  const now = new Date();
  return {
    from: isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    to: isoDay(new Date(now.getFullYear(), now.getMonth(), 0)),
  };
}

// Ausgangsrechnungen als DATEV-Buchungsstapel für den Steuerberater.
export function DatevSection({ canEdit, canExport }: { canEdit: boolean; canExport: boolean }) {
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [chart, setChart] = useState<Chart>('SKR03');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [range, setRange] = useState(previousMonth);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  // Zahlungseingänge mitexportieren – nur, wenn die Kanzlei die Bankumsätze
  // nicht ohnehin direkt aus dem Bankkonto übernimmt (sonst doppelt gebucht)
  const [withPayments, setWithPayments] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<DatevSettings>('/company/settings')
      .then((s) =>
        // Nur die erste Antwort übernehmen, damit Eingaben nicht überschrieben werden
        setForm((current) => {
          if (current) return current;
          setChart(s.datevChartOfAccounts);
          return {
            consultant: s.datevConsultantNumber ? String(s.datevConsultantNumber) : '',
            client: s.datevClientNumber ? String(s.datevClientNumber) : '',
            ...Object.fromEntries(
              ACCOUNT_LABELS.map(({ key }) => [key, String(s.datevRevenueAccounts?.[key] ?? '')]),
            ),
          };
        }),
      )
      .catch(() => setMessage({ ok: false, text: 'DATEV-Einstellungen konnten nicht geladen werden.' }));
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setMessage(null);
    try {
      const accounts = Object.fromEntries(
        ACCOUNT_LABELS.filter(({ key }) => form[key]?.trim()).map(({ key }) => [key, Number(form[key])]),
      );
      await api.patch('/company/settings', {
        ...(form.consultant.trim() ? { datevConsultantNumber: Number(form.consultant) } : {}),
        ...(form.client.trim() ? { datevClientNumber: Number(form.client) } : {}),
        datevChartOfAccounts: chart,
        datevRevenueAccounts: accounts,
      });
      setMessage({ ok: true, text: 'DATEV-Einstellungen gespeichert.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.' });
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setExportMessage(null);
    setBusy(true);
    try {
      const compact = (day: string) => day.replace(/-/g, '');
      await api.downloadFile(
        `/datev/bookings?from=${range.from}&to=${range.to}${withPayments ? '&payments=1' : ''}`,
        `EXTF_Buchungsstapel_${compact(range.from)}_${compact(range.to)}.csv`,
      );
    } catch (err) {
      setExportMessage(err instanceof ApiError ? err.message : 'Export fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  // Stammdaten der Debitoren (Name, Anschrift) – einmal vorab und bei neuen Kunden
  const downloadDebtors = async () => {
    setExportMessage(null);
    setBusy(true);
    try {
      await api.downloadFile('/datev/debtors', 'EXTF_Debitoren.csv');
    } catch (err) {
      setExportMessage(err instanceof ApiError ? err.message : 'Export fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" data-testid="datev-section">
      <h3>DATEV-Export</h3>
      <p>
        Ausgangsrechnungen als Buchungsstapel für den Steuerberater: je Rechnung eine Buchung vom
        Debitorenkonto des Kunden auf das Erlöskonto, Stornorechnungen im Haben. Die Datei lässt sich in DATEV
        Rechnungswesen importieren (Stapelverarbeitung → ASCII-Import).
      </p>

      {canExport && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
          <label className="field">
            <span>Von</span>
            <input
              type="date"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
              data-testid="datev-from"
            />
          </label>
          <label className="field">
            <span>Bis</span>
            <input
              type="date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
              data-testid="datev-to"
            />
          </label>
          <button className="btn btn-primary" onClick={download} disabled={busy} data-testid="datev-export">
            Buchungsstapel herunterladen
          </button>
        </div>
      )}
      {canExport && (
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem', marginBottom: 12 }}
        >
          <input
            type="checkbox"
            checked={withPayments}
            onChange={(e) => setWithPayments(e.target.checked)}
            data-testid="datev-with-payments"
          />
          Zahlungseingänge mitexportieren (Bank bzw. Kasse an Debitor) – nur, wenn der Steuerberater die
          Bankumsätze nicht selbst aus dem Bankkonto übernimmt, sonst sind sie doppelt gebucht.
        </label>
      )}
      {canExport && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <button className="btn" onClick={downloadDebtors} disabled={busy} data-testid="datev-debtors">
            Debitoren (Kunden) herunterladen
          </button>
          <span className="list-item-meta">
            Name, Anschrift, USt-IdNr. und Kontakt je Debitorenkonto – vor dem ersten Buchungsstapel und bei
            neuen Kunden an den Steuerberater geben.
          </span>
        </div>
      )}
      {exportMessage && (
        <p className="field-error" data-testid="datev-export-message">
          {exportMessage}
        </p>
      )}

      {canEdit && form === null && !message && <p>Lädt …</p>}
      {canEdit && form !== null && (
        <form onSubmit={save} className="login-form">
          <label className="field">
            <span>Beraternummer</span>
            <input
              value={form.consultant}
              onChange={(e) => setForm({ ...form, consultant: e.target.value })}
              inputMode="numeric"
              data-testid="datev-consultant"
            />
          </label>
          <label className="field">
            <span>Mandantennummer</span>
            <input
              value={form.client}
              onChange={(e) => setForm({ ...form, client: e.target.value })}
              inputMode="numeric"
              data-testid="datev-client"
            />
          </label>
          <label className="field">
            <span>Kontenrahmen</span>
            <select
              value={chart}
              onChange={(e) => setChart(e.target.value as Chart)}
              data-testid="datev-chart"
            >
              <option value="SKR03">SKR 03</option>
              <option value="SKR04">SKR 04</option>
            </select>
          </label>
          <p className="list-item-meta">
            Erlös- und Geldkonten: leer lassen für die Standardkonten; nur ändern, wenn der Steuerberater
            andere vorgibt. Kunden bekommen automatisch Debitorennummern ab 10000 (änderbar beim Kunden).
          </p>
          {ACCOUNT_LABELS.map(({ key, label }) => (
            <label key={key} className="field">
              <span>{label}</span>
              <input
                value={form[key] ?? ''}
                placeholder={String(DEFAULT_ACCOUNTS[chart][key])}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                inputMode="numeric"
                data-testid={`datev-account-${key}`}
              />
            </label>
          ))}
          {message && (
            <p className={message.ok ? 'list-item-meta' : 'field-error'} data-testid="datev-message">
              {message.text}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="datev-submit">
            Speichern
          </button>
        </form>
      )}
    </section>
  );
}
