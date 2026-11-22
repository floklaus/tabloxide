import { nextTheme, THEME_LABELS } from './theme'
import { useThemeStore } from './themeStore'

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
