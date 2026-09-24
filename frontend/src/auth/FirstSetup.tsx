import { FormEvent, useState } from 'react';
import { api, ApiError } from '../api/client';

// Ersteinrichtung (Mini-Vollversion): Firma und ersten Zugang anlegen. Der
// Einrichtungscode steht in der Ausgabe des Startskripts.
export function FirstSetup({ onDone }: { onDone: (email: string, password: string) => void }) {
  const [form, setForm] = useState({
    code: '',
    companyName: '',
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    repeat: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (form.password !== form.repeat) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { code, companyName, firstName, lastName, email, password } = form;
      const r = await api.post<{ email: string }>('/setup', {
        code,
        companyName,
        firstName,
        lastName,
        email,
        password,
      });
      onDone(r.email, form.password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Einrichtung fehlgeschlagen.');
      setBusy(false);
    }
  };

  const field = (key: keyof typeof form, label: string, props: Record<string, unknown> = {}) => (
    <label className="field">
      <span>{label}</span>
      <input
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        required
        data-testid={`setup-${key}`}
        {...props}
      />
    </label>
  );

  return (
    <form onSubmit={submit} className="login-form" data-testid="first-setup">
      <p className="login-subtitle">
        Willkommen! Lege deine Firma und deinen Zugang an. Den Einrichtungscode zeigt das Startskript an.
      </p>
      {field('code', 'Einrichtungscode', { autoComplete: 'off' })}
      {field('companyName', 'Firma', { minLength: 2 })}
      {field('firstName', 'Vorname')}
      {field('lastName', 'Nachname')}
      {field('email', 'E-Mail', { type: 'email', autoComplete: 'username' })}
      {field('password', 'Passwort (mindestens 10 Zeichen)', {
        type: 'password',
        minLength: 10,
        autoComplete: 'new-password',
      })}
      {field('repeat', 'Passwort wiederholen', { type: 'password', autoComplete: 'new-password' })}
      {error && (
        <p className="field-error" data-testid="setup-error">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy} data-testid="setup-submit">
        {busy ? 'Richtet ein …' : 'Einrichten und anmelden'}
      </button>
    </form>
  );
}
