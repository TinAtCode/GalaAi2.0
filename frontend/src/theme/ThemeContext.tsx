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

// Erscheinungsbild: bisheriges GartenAI oder das neue gAla (brand/README.md)
export type Look = 'gartenai' | 'gala';

export const LOOKS: Record<Look, { name: string; defaults: ThemeColors }> = {
  gartenai: { name: 'GartenAI', defaults: { primary: '#2f4b3c', accent: '#c98a3b', background: '#f7f7f4' } },
  // Tannengrün, Rasengrün, heller Hintergrund mit einem Hauch Grün
  gala: { name: 'gAla', defaults: { primary: '#1f4a2e', accent: '#6c9a3c', background: '#f4f6f2' } },
};

export const DEFAULT_THEME: ThemeColors = LOOKS.gartenai.defaults;

// eigene Farben je Erscheinungsbild getrennt gespeichert
const STORAGE_KEY: Record<Look, string> = { gartenai: 'gartenai.theme', gala: 'gartenai.theme-gala' };
const MODE_KEY = 'gartenai.theme-mode';
const LOOK_KEY = 'gartenai.look';

interface ThemeContextValue {
  theme: ThemeColors;
  setTheme: (theme: ThemeColors) => void;
  resetTheme: () => void;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  look: Look;
  setLook: (look: Look) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Eigene Farben als --user-*: tokens.css leitet daraus die Farben für hell
// und dunkel ab (im Dunkelmodus gilt der eigene Hintergrund nicht)
function applyThemeToDocument(theme: ThemeColors, mode: ThemeMode, look: Look) {
  const root = document.documentElement;
  root.setAttribute('data-look', look);
  document.title = LOOKS[look].name;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.primary);
  document
    .querySelector('link[rel="icon"]')
    ?.setAttribute('href', look === 'gala' ? '/gala-mark.svg' : '/icon.svg');
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

function loadStoredTheme(look: Look): ThemeColors {
  const defaults = LOOKS[look].defaults;
  try {
    const raw = read(STORAGE_KEY[look]);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

function loadStoredLook(): Look {
  return read(LOOK_KEY) === 'gala' ? 'gala' : 'gartenai';
}

function loadStoredMode(): ThemeMode {
  const raw = read(MODE_KEY);
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [look, setLookState] = useState<Look>(() => loadStoredLook());
  const [theme, setThemeState] = useState<ThemeColors>(() => loadStoredTheme(loadStoredLook()));
  const [mode, setModeState] = useState<ThemeMode>(() => loadStoredMode());

  useEffect(() => {
    applyThemeToDocument(theme, mode, look);
  }, [theme, mode, look]);

  const setTheme = useCallback(
    (next: ThemeColors) => {
      setThemeState(next);
      write(STORAGE_KEY[look], JSON.stringify(next));
    },
    [look],
  );

  // beim Wechsel die (eigenen) Farben dieses Erscheinungsbilds übernehmen
  const setLook = useCallback((next: Look) => {
    setLookState(next);
    setThemeState(loadStoredTheme(next));
    write(LOOK_KEY, next);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    write(MODE_KEY, next);
  }, []);

  const resetTheme = useCallback(() => setTheme(LOOKS[look].defaults), [setTheme, look]);

  const value = useMemo(
    () => ({ theme, setTheme, resetTheme, mode, setMode, look, setLook }),
    [theme, setTheme, resetTheme, mode, setMode, look, setLook],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme muss innerhalb von <ThemeProvider> verwendet werden.');
  return ctx;
}
