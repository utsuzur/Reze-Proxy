const THEME_KEY = 'reze_theme';

export type ThemeMode = 'light' | 'dark';

export const getStoredTheme = (): ThemeMode => {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === 'dark' ? 'dark' : 'light';
};

export const applyTheme = (theme: ThemeMode) => {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.dataset.theme = theme;
};

export const setStoredTheme = (theme: ThemeMode) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
};
