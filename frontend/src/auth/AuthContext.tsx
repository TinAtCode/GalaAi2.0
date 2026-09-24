import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { api, ApiError, setUnauthorizedHandler, startNewSessionGeneration } from '../api/client';
import { offlineDb } from '../offline/db';
import { disablePush } from '../push/push';

interface CurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  permissions: string[];
}

interface LoginResponse {
  user: CurrentUser;
}

interface AuthContextValue {
  user: CurrentUser | null;
  // true, solange beim Start noch geprüft wird, ob eine Sitzung besteht
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  // Eigenes Passwort ändern; andere Geräte werden dabei abgemeldet.
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  hasPermission: (key: string) => boolean;
  // true, wenn die Sitzung abgelaufen ist (für den Hinweis auf der Login-Seite)
  sessionExpired: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Das Token liegt im httpOnly-Cookie (für JavaScript unsichtbar). Hier steht
// nur ein Merker, dass jemand angemeldet war – damit die Login-Seite nach
// Ablauf der Sitzung einen Hinweis zeigen kann. Kein Geheimnis.
const SESSION_MARKER = 'gartenai.session';
// Ältere Versionen haben das Token im localStorage gespeichert.
const LEGACY_KEYS = ['gartenai.token', 'gartenai.user'];

// Für das Arbeiten ohne Netz: Name und Rechte der letzten Anmeldung (nur für
// die Anzeige – jede Anfrage prüft der Server wie immer selbst)
const OFFLINE_USER = 'gartenai.offline-user';
function offlineUser(action: 'set' | 'remove' | 'get', user?: CurrentUser): CurrentUser | null {
  try {
    if (action === 'set') localStorage.setItem(OFFLINE_USER, JSON.stringify(user));
    if (action === 'remove') localStorage.removeItem(OFFLINE_USER);
    const raw = localStorage.getItem(OFFLINE_USER);
    return raw ? (JSON.parse(raw) as CurrentUser) : null;
  } catch {
    return null;
  }
}

function marker(action: 'set' | 'remove' | 'get'): boolean {
  try {
    if (action === 'set') localStorage.setItem(SESSION_MARKER, '1');
    if (action === 'remove') localStorage.removeItem(SESSION_MARKER);
    return localStorage.getItem(SESSION_MARKER) === '1';
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  // Meldet sich jemand an, während die Prüfung beim Start noch läuft, zählt
  // die Anmeldung – nicht die ältere Antwort der Prüfung.
  const loggedInMeanwhile = useRef(false);

  const endSession = useCallback((expired: boolean) => {
    if (expired && marker('get')) setSessionExpired(true);
    marker('remove');
    offlineUser('remove');
    setUser(null);
  }, []);

  // Beim Start: besteht noch eine Sitzung (Cookie)? Nur ein 401 heißt "nicht
  // angemeldet"; bei anderen Fehlern (Netz, 429, 5xx) wird einmal wiederholt,
  // statt eine gültige Sitzung als abgelaufen zu melden.
  useEffect(() => {
    try {
      LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
    } catch {
      // ohne Speicher (privater Modus) gibt es nichts aufzuräumen
    }
    const check = (retry: boolean): Promise<void> =>
      api
        .get<CurrentUser>('/auth/me')
        .then((me) => {
          if (loggedInMeanwhile.current) return;
          marker('set');
          offlineUser('set', me);
          setUser(me);
        })
        .catch((err: unknown) => {
          if (loggedInMeanwhile.current) return;
          if (err instanceof ApiError && err.status === 401) return endSession(true);
          if (retry)
            return new Promise<void>((resolve) => setTimeout(resolve, 1000)).then(() => check(false));
          // Server nicht erreichbar (offline): mit der letzten Anmeldung weiterarbeiten
          const cached = !(err instanceof ApiError) && marker('get') ? offlineUser('get') : null;
          setUser(cached);
        });
    check(true).finally(() => setLoading(false));
  }, [endSession]);

  const startSession = (result: LoginResponse) => {
    loggedInMeanwhile.current = true;
    startNewSessionGeneration();
    marker('set');
    // anderer Nutzer auf diesem Gerät: dessen Offline-Daten nie unter der neuen
    // Anmeldung übertragen
    const previous = offlineUser('get');
    if (previous && previous.id !== result.user.id) void offlineDb.clear().catch(() => undefined);
    offlineUser('set', result.user);
    setSessionExpired(false);
    setUser(result.user);
  };

  const login = async (email: string, password: string) => {
    startSession(await api.post<LoginResponse>('/auth/login', { email, password }));
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    startSession(await api.post<LoginResponse>('/auth/change-password', { currentPassword, newPassword }));
  };

  const logout = useCallback(async () => {
    // Push-Nachrichten an diese Person nicht mehr auf dieses Gerät (geteilte Handys)
    await disablePush().catch(() => undefined);
    await api.post('/auth/logout').catch(() => undefined);
    startNewSessionGeneration();
    // offline gespeicherte Pläne gehören zu dieser Anmeldung
    await offlineDb.clear().catch(() => undefined);
    endSession(false);
  }, [endSession]);

  // 401 während der Nutzung: Sitzung abgelaufen oder ungültig.
  useEffect(() => {
    setUnauthorizedHandler(() => endSession(true));
    return () => setUnauthorizedHandler(null);
  }, [endSession]);

  const hasPermission = (key: string) => user?.permissions.includes(key) ?? false;

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, changePassword, hasPermission, sessionExpired }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth muss innerhalb von <AuthProvider> verwendet werden.');
  return ctx;
}

export { ApiError };
