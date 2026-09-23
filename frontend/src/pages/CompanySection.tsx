import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

interface CompanySettings {
  name: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  taxNumber: string | null;
  vatId: string | null;
  email: string | null;
  phone: string | null;
  contactName: string | null;
  iban: string | null;
  bic: string | null;
  paymentTermDays: number;
  smallBusiness: boolean;
  defaultVatRate: string | number;
}

const FIELDS: { key: keyof CompanySettings; label: string }[] = [
  { key: 'name', label: 'Firmenname' },
  { key: 'street', label: 'Straße und Hausnummer' },
  { key: 'postalCode', label: 'PLZ' },
  { key: 'city', label: 'Ort' },
  { key: 'taxNumber', label: 'Steuernummer' },
  { key: 'vatId', label: 'USt-IdNr.' },
  { key: 'email', label: 'E-Mail' },
  { key: 'phone', label: 'Telefon' },
  { key: 'contactName', label: 'Ansprechpartner' },
  { key: 'iban', label: 'IBAN' },
  { key: 'bic', label: 'BIC' },
];

// Firmendaten, die auf jeder Rechnung stehen müssen (§ 14 UStG).
export function CompanySection() {
  // null = noch nicht geladen. Die Maske erscheint erst danach – sonst würde
  // das Nachladen bereits getippte Eingaben überschreiben.
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [smallBusiness, setSmallBusiness] = useState(false);

  useEffect(() => {
    api
      .get<CompanySettings>('/company/settings')
      .then((settings) => {
        // Nur die erste Antwort übernehmen: kommt eine zweite (React lädt im
        // Entwicklungsmodus doppelt), sind evtl. schon Eingaben gemacht.
        setForm((current) => {
          if (current) return current;
          setSmallBusiness(settings.smallBusiness);
          return {
            ...Object.fromEntries(FIELDS.map((f) => [f.key, String(settings[f.key] ?? '')])),
            defaultVatRate: String(Number(settings.defaultVatRate)),
            paymentTermDays: String(settings.paymentTermDays),
          };
        });
      })
      .catch(() => setMessage({ ok: false, text: 'Firmendaten konnten nicht geladen werden.' }));
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const body: Record<string, string | number | boolean> = {};
      for (const field of FIELDS) {
        if (form?.[field.key]?.trim()) body[field.key] = form[field.key].trim();
      }
      body.defaultVatRate = Number((form?.defaultVatRate ?? '19').replace(',', '.'));
      body.paymentTermDays = Number(form?.paymentTermDays ?? '14');
      body.smallBusiness = smallBusiness;
      await api.patch('/company/settings', body);
      setMessage({ ok: true, text: 'Firmendaten gespeichert.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section">
      <h3>Firmendaten</h3>
      <p>
        Diese Angaben erscheinen auf jeder Rechnung. Ohne Anschrift und Steuernummer (oder USt-IdNr.) lässt
        sich keine Rechnung ausstellen. Für die E-Rechnung (XRechnung) werden zusätzlich E-Mail, Telefon und
        IBAN gebraucht.
      </p>
      {form === null && !message && <p>Lädt …</p>}
      {form !== null && (
        <form onSubmit={handleSubmit} className="login-form">
          {FIELDS.map((field) => (
            <label key={field.key} className="field">
              <span>{field.label}</span>
              <input
                value={form[field.key] ?? ''}
                onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                data-testid={`company-${field.key}`}
              />
            </label>
          ))}
          <label className="field">
            <span>Standard-Umsatzsteuersatz (%)</span>
            <input
              value={form.defaultVatRate ?? ''}
              onChange={(e) => setForm({ ...form, defaultVatRate: e.target.value })}
              inputMode="decimal"
              data-testid="company-defaultVatRate"
            />
          </label>
          <label className="field">
            <span>Zahlungsziel (Tage)</span>
            <input
              value={form.paymentTermDays ?? ''}
              onChange={(e) => setForm({ ...form, paymentTermDays: e.target.value })}
              inputMode="numeric"
              data-testid="company-paymentTermDays"
            />
          </label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={smallBusiness}
              onChange={(e) => setSmallBusiness(e.target.checked)}
              data-testid="company-smallBusiness"
            />
            <span>Kleinunternehmer (§ 19 UStG) – Angebote und Rechnungen ohne Umsatzsteuer</span>
          </label>
          {message && (
            <p className={message.ok ? 'list-item-meta' : 'field-error'} data-testid="company-message">
              {message.text}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="company-submit">
            Speichern
          </button>
        </form>
      )}
    </section>
  );
}
