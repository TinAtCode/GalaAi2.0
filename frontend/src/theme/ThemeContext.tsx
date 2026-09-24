import { createContext, useContext, useEffect, useMemo, useCallback, useState, ReactNode } from 'react';

// Nur die Variablen, die die Einstellungen-Seite anbieten soll. Die übrigen
// Tokens (Radius, Schrift, Abstände) bleiben bewusst fix – "anpassbar" heißt
// hier "Farben/Darstellung", nicht "jede Komponente frei umbaubar".
export interface ThemeColors {
  primary: string;
  accent: string;
  background: string;
}

// Hell, dunkel oder wie das Betriebssystem
export type ThemeMode = 'system' | 'light' | 'dark';

export const DEFAULT_THEME: ThemeColors = {
  primary: '#2f4b3c',
  accent: '#c98a3b',
  background: '#f7f7f4',
};

const STORAGE_KEY = 'gartenai.theme';
const MODE_KEY = 'gartenai.theme-mode';

interface ThemeContextValue {
  theme: ThemeColors;
  setTheme: (theme: ThemeColors) => void;
  resetTheme: () => void;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Eigene Farben als --user-*: tokens.css leitet daraus die Farben für hell
// und dunkel ab (im Dunkelmodus gilt der eigene Hintergrund nicht)
function applyThemeToDocument(theme: ThemeColors, mode: ThemeMode) {
  const root = document.documentElement;
  root.style.setProperty('--user-primary', theme.primary);
  root.style.setProperty('--user-accent', theme.accent);
  root.style.setProperty('--user-background', theme.background);
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

// localStorage kann fehlen oder gesperrt sein (privates Fenster)
function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Darstellung gilt dann nur für diese Sitzung
  }
}

function loadStoredTheme(): ThemeColors {
  try {
    const raw = read(STORAGE_KEY);
    return raw ? { ...DEFAULT_THEME, ...JSON.parse(raw) } : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function loadStoredMode(): ThemeMode {
  const raw = read(MODE_KEY);
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeColors>(() => loadStoredTheme());
  const [mode, setModeState] = useState<ThemeMode>(() => loadStoredMode());

  useEffect(() => {
    applyThemeToDocument(theme, mode);
  }, [theme, mode]);

  const setTheme = useCallback((next: ThemeColors) => {
    setThemeState(next);
    write(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    write(MODE_KEY, next);
  }, []);

  const resetTheme = useCallback(() => setTheme(DEFAULT_THEME), [setTheme]);

  const value = useMemo(
    () => ({ theme, setTheme, resetTheme, mode, setMode }),
    [theme, setTheme, resetTheme, mode, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme muss innerhalb von <ThemeProvider> verwendet werden.');
  return ctx;
}
