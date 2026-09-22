import { FormEvent, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';

export function ChangePasswordSection() {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setMessage({ ok: true, text: 'Passwort geändert. Andere Geräte wurden abgemeldet.' });
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Passwort konnte nicht geändert werden.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section">
      <h3>Passwort ändern</h3>
      <form onSubmit={handleSubmit} className="login-form">
        <label className="field">
          <span>Aktuelles Passwort</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
            data-testid="password-current"
          />
        </label>
        <label className="field">
          <span>Neues Passwort (mindestens 10 Zeichen)</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            maxLength={72}
            required
            data-testid="password-new"
          />
        </label>
        {message && (
          <p className={message.ok ? 'list-item-meta' : 'field-error'} data-testid="password-message">
            {message.text}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="password-submit">
          Passwort ändern
        </button>
      </form>
    </section>
  );
}
