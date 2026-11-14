import { nextTheme, type Theme } from './theme'
import { useThemeStore } from './themeStore'

const THEME_LABELS: Record<Theme, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  const next = nextTheme(theme)

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Theme: ${THEME_LABELS[theme]}. Change to ${THEME_LABELS[next]}.`}
      onClick={() => setTheme(next)}
    >
      Theme: {THEME_LABELS[theme]}
    </button>
  )
}
