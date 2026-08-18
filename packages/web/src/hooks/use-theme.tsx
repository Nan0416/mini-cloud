import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export const THEMES: ReadonlyArray<Theme> = ['light', 'dark', 'system'];

/** Must match the key the pre-paint script in index.html reads. */
const STORAGE_KEY = 'mini-cloud.theme';

interface ThemeContextValue {
  readonly theme: Theme;
  /** What `system` currently resolves to. Never `system` itself. */
  readonly resolved: 'light' | 'dark';
  readonly setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return THEMES.find((candidate) => candidate === stored) ?? 'system';
  } catch {
    // Private-mode browsers throw on localStorage. Following the OS is the safe default.
    return 'system';
  }
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider(props: { readonly children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark);

  // Tracked rather than read on each render, so switching the OS theme repaints the
  // console live instead of only after a reload.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  const setTheme = useCallback((next: Theme): void => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisting is a smaller failure than refusing to change the theme.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === undefined) {
    throw new Error('useTheme must be used inside a ThemeProvider.');
  }
  return value;
}
