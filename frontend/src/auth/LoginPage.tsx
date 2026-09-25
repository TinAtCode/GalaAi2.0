import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { api, ApiError, apiUrl } from '../api/client';
import { DemoPanel } from './DemoPanel';
import { FirstSetup } from './FirstSetup';
import { Brand } from '../brand/Brand';

// Rückmeldungen vom Anmelden über Google/Firmenkonto (?sso=…, auth.controller.ts)
const SSO_ERRORS: Record<string, string> = {
  user: 'Zu dieser E-Mail-Adresse gibt es kein aktives Konto. Das Büro muss dich zuerst anlegen – mit derselben E-Mail-Adresse.',
  email: 'Der Anbieter hat keine bestätigte E-Mail-Adresse übermittelt.',
  domain: 'Anmeldung mit dieser E-Mail-Domain ist nicht freigegeben.',
  state: 'Die Anmeldung ist abgelaufen oder wurde in einem anderen Browser begonnen. Bitte erneut versuchen.',
  config: 'Anmeldung über einen Anbieter ist nicht eingerichtet.',
};

export function LoginPage() {
  const { login, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [params] = useSearchParams();
  const sso = params.get('sso');
  const [error, setError] = useState<string | null>(
    sso ? (SSO_ERRORS[sso] ?? 'Anmeldung über den Anbieter fehlgeschlagen. Bitte erneut versuchen.') : null,
  );
  const [provider, setProvider] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // noch kein Zugang eingerichtet (Mini-Vollversion): Ersteinrichtung statt Anmeldung
  const [setupNeeded, setSetupNeeded] = useState(false);
  useEffect(() => {
    api
      .get<{ needed: boolean }>('/setup/status')
      .then((r) => setSetupNeeded(r.needed))
      .catch(() => setSetupNeeded(false));
    api
      .get<{ enabled: boolean; label?: string }>('/auth/oidc')
      .then((r) => setProvider(r.enabled ? (r.label ?? 'Firmenkonto') : null))
      .catch(() => setProvider(null));
  }, []);

  const signIn = async (loginEmail: string, loginPassword: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await login(loginEmail, loginPassword);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void signIn(email, password);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>
          <Brand size="login" />
        </h1>
        <p className="login-subtitle">Melde dich mit deinem Firmenzugang an.</p>
        {sessionExpired && (
          <p className="field-error" data-testid="login-session-expired">
            Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.
          </p>
        )}

        {setupNeeded ? (
          <FirstSetup onDone={(doneEmail, donePassword) => void signIn(doneEmail, donePassword)} />
        ) : (
          <form onSubmit={handleSubmit} className="login-form">
            <label className="field">
              <span>E-Mail</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
                data-testid="login-email"
              />
            </label>

            <label className="field">
              <span>Passwort</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                data-testid="login-password"
              />
            </label>

            {error && (
              <p className="field-error" data-testid="login-error">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={submitting}
              data-testid="login-submit"
            >
              {submitting ? 'Meldet an …' : 'Anmelden'}
            </button>
            {provider && (
              <>
                <div className="login-divider">oder</div>
                <a className="btn btn-block" href={apiUrl('/auth/oidc/start')} data-testid="login-oidc">
                  Anmelden mit {provider}
                </a>
              </>
            )}
          </form>
        )}
        <DemoPanel
          onPick={(pickedEmail, pickedPassword) => {
            setEmail(pickedEmail);
            setPassword(pickedPassword);
            void signIn(pickedEmail, pickedPassword);
          }}
        />
      </div>
    </div>
  );
}
