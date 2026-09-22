import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, ApiError, setUnauthorizedHandler } from '../api/client';

interface CurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  permissions: string[];
}

interface LoginResponse {
  accessToken: string;
  user: CurrentUser;
}

interface AuthContextValue {
  user: CurrentUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (key: string) => boolean;
  // true, wenn die Sitzung abgelaufen ist (für den Hinweis auf der Login-Seite)
  sessionExpired: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_KEY = 'gartenai.token';
const USER_KEY = 'gartenai.user';

// Ablaufzeit aus dem JWT lesen (nur zur Anzeige – geprüft wird das Token
// ausschließlich im Backend). Kaputte Tokens gelten als abgelaufen.
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

function loadStoredUser(): CurrentUser | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const raw = localStorage.getItem(USER_KEY);
    if (!token || !raw || isTokenExpired(token)) return null;
    return JSON.parse(raw) as CurrentUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(() => loadStoredUser());
  const [sessionExpired, setSessionExpired] = useState(
    () => loadStoredUser() === null && localStorage.getItem(TOKEN_KEY) !== null,
  );

  const login = async (email: string, password: string) => {
    const result = await api.post<LoginResponse>('/auth/login', { email, password });
    localStorage.setItem(TOKEN_KEY, result.accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    setSessionExpired(false);
    setUser(result.user);
  };

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  // Abgelaufenes Token beim Start aufräumen, 401 während der Nutzung abfangen.
  useEffect(() => {
    if (sessionExpired) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
    setUnauthorizedHandler(() => {
      setSessionExpired(true);
      logout();
    });
    return () => setUnauthorizedHandler(null);
  }, [logout, sessionExpired]);

  const hasPermission = (key: string) => user?.permissions.includes(key) ?? false;

  return (
    <AuthContext.Provider value={{ user, login, logout, hasPermission, sessionExpired }}>
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
