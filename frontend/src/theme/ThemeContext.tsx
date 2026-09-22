import { createContext, useContext, useEffect, useMemo, useCallback, useState, ReactNode } from 'react';

// Nur die Variablen, die die Einstellungen-Seite anbieten soll. Die übrigen
// Tokens (Radius, Schrift, Abstände) bleiben bewusst fix – "anpassbar" heißt
// hier "Farben/Darstellung", nicht "jede Komponente frei umbaubar".
export interface ThemeColors {
  primary: string;
  accent: string;
  background: string;
}

const DEFAULT_THEME: ThemeColors = {
  primary: '#2f4b3c',
  accent: '#c98a3b',
  background: '#f7f7f4',
};

const STORAGE_KEY = 'gartenai.theme';

interface ThemeContextValue {
  theme: ThemeColors;
  setTheme: (theme: ThemeColors) => void;
  resetTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function applyThemeToDocument(theme: ThemeColors) {
  const root = document.documentElement.style;
  root.setProperty('--color-primary', theme.primary);
  root.setProperty('--color-accent', theme.accent);
  root.setProperty('--color-background', theme.background);
}

function loadStoredTheme(): ThemeColors {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_THEME, ...parsed };
  } catch {
    return DEFAULT_THEME;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeColors>(() => loadStoredTheme());

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeColors) => {
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const resetTheme = useCallback(() => setTheme(DEFAULT_THEME), [setTheme]);

  const value = useMemo(() => ({ theme, setTheme, resetTheme }), [theme, setTheme, resetTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme muss innerhalb von <ThemeProvider> verwendet werden.');
  return ctx;
}
