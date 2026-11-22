export const THEMES = [
  'system',
  'light',
  'dark',
  'neon',
  'high-contrast',
] as const

/** The name of each theme for the user. */
export const THEME_LABELS: Record<Theme, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  neon: 'Neon',
  'high-contrast': 'High contrast',
}

export type Theme = (typeof THEMES)[number]

export const DEFAULT_THEME: Theme = 'system'

const THEME_STORAGE_KEY = 'tabloxide.theme'

function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value)
}

/** Reads the stored theme. Returns the default theme if storage is empty, invalid, or not available. */
export function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/** Stores the theme. A storage failure is not an error, because the theme still applies to this session. */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage is not available (for example in a private window).
  }
}

/** Sets the theme on the document. `system` removes the attribute, and CSS then follows the OS setting. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') {
    delete root.dataset.theme
    return
  }
  root.dataset.theme = theme
}

/** Returns the theme that follows `theme` in the sequence of `THEMES`. */
export function nextTheme(theme: Theme): Theme {
  const index = THEMES.indexOf(theme)
  return THEMES[(index + 1) % THEMES.length]
}
