import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  active: boolean;
  roles: { role: { id: string; name: string } }[];
  employee: { id: string } | null;
  anonymizedAt: string | null;
}

interface Role {
  id: string;
  name: string;
}

const EMPTY_FORM = { firstName: '', lastName: '', email: '', password: '', roleId: '', createEmployee: true };

// Nur mit system.settings.write sichtbar (siehe SettingsPage).
export function UsersSection() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<UserRow[]>('/users')
      .then(setUsers)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Benutzer konnten nicht geladen werden.'),
      );

  useEffect(() => {
    load();
    api
      .get<Role[]>('/roles')
      .then(setRoles)
      .catch(() => setRoles([]));
  }, []);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await run(() =>
      api.post('/users', {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        password: form.password,
        roleIds: form.roleId ? [form.roleId] : [],
        createEmployee: form.createEmployee,
      }),
    );
    if (ok) setForm(EMPTY_FORM);
  };

  const resetPassword = (target: UserRow) => {
    const password = window.prompt(
      `Neues Passwort für ${target.firstName} ${target.lastName} (mindestens 10 Zeichen):`,
    );
    if (password) run(() => api.post(`/users/${target.id}/password`, { password }));
  };

  // Datenschutz: Auskunft als Datei, Anonymisieren (Zeiten bleiben wegen Aufbewahrung)
  const exportData = (target: UserRow) =>
    run(() =>
      api.downloadFile(`/users/${target.id}/export`, `auskunft-nutzer-${target.id.slice(0, 8)}.json`),
    );

  const anonymize = (target: UserRow) => {
    if (
      window.confirm(
        `${target.firstName} ${target.lastName} anonymisieren? Name und E-Mail werden unwiderruflich entfernt, ` +
          'die Anmeldung ist danach nicht mehr möglich. Zeiten und Protokoll bleiben erhalten (Aufbewahrungspflicht).',
      )
    )
      run(() => api.post(`/users/${target.id}/anonymize`));
  };

  return (
    <section className="settings-section">
      <h3>Benutzer</h3>
      {error && <p className="field-error">{error}</p>}
      {users === null && !error && <p>Lädt …</p>}

      {users?.map((u) => (
        <div key={u.id} className="list-item" data-testid="user-item">
          <div>
            <div className="list-item-name">
              {u.firstName} {u.lastName}
            </div>
            <div className="list-item-meta">
              {u.email}
              {u.roles.length > 0 ? ` · ${u.roles.map((r) => r.role.name).join(', ')}` : ' · keine Rolle'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              className={`status-badge ${u.active ? 'status-done' : 'status-cancelled'}`}
              data-testid="user-status"
            >
              {u.anonymizedAt ? 'Anonymisiert' : u.active ? 'Aktiv' : 'Deaktiviert'}
            </span>
            {!u.anonymizedAt && (
              <button className="btn" disabled={busy} onClick={() => exportData(u)} data-testid="user-export">
                Auskunft
              </button>
            )}
            {u.id !== me?.id && !u.anonymizedAt && (
              <>
                <button className="btn" disabled={busy} onClick={() => resetPassword(u)}>
                  Passwort setzen
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => run(() => api.patch(`/users/${u.id}`, { active: !u.active }))}
                  data-testid="user-toggle-active"
                >
                  {u.active ? 'Deaktivieren' : 'Aktivieren'}
                </button>
                <button
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => anonymize(u)}
                  data-testid="user-anonymize"
                >
                  Anonymisieren
                </button>
              </>
            )}
          </div>
        </div>
      ))}

      <h3 style={{ marginTop: 24 }}>Neuen Benutzer anlegen</h3>
      <form onSubmit={handleCreate} className="login-form">
        <label className="field">
          <span>Vorname</span>
          <input
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            required
            data-testid="user-first-name"
          />
        </label>
        <label className="field">
          <span>Nachname</span>
          <input
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            required
            data-testid="user-last-name"
          />
        </label>
        <label className="field">
          <span>E-Mail</span>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
            data-testid="user-email"
          />
        </label>
        <label className="field">
          <span>Startpasswort (mindestens 10 Zeichen)</span>
          <input
            type="text"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            minLength={10}
            maxLength={72}
            required
            autoComplete="off"
            data-testid="user-password"
          />
        </label>
        <label className="field">
          <span>Rolle</span>
          <select
            value={form.roleId}
            onChange={(e) => setForm({ ...form, roleId: e.target.value })}
            data-testid="user-role"
          >
            <option value="">– keine –</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="list-item-meta" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={form.createEmployee}
            onChange={(e) => setForm({ ...form, createEmployee: e.target.checked })}
          />
          Mitarbeiterprofil anlegen (für Zeiterfassung)
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="user-submit">
          Benutzer anlegen
        </button>
      </form>
    </section>
  );
}
