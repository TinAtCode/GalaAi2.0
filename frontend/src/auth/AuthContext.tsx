import { createContext, useContext, useState, ReactNode } from 'react';
import { api, ApiError } from '../api/client';

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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_KEY = 'gartenai.token';
const USER_KEY = 'gartenai.user';

function loadStoredUser(): CurrentUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as CurrentUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(() => loadStoredUser());

  const login = async (email: string, password: string) => {
    const result = await api.post<LoginResponse>('/auth/login', { email, password });
    localStorage.setItem(TOKEN_KEY, result.accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    setUser(result.user);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  };

  const hasPermission = (key: string) => user?.permissions.includes(key) ?? false;

  return (
    <AuthContext.Provider value={{ user, login, logout, hasPermission }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth muss innerhalb von <AuthProvider> verwendet werden.');
  return ctx;
}

export { ApiError };
