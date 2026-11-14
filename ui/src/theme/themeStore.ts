import { create } from 'zustand'
import { applyTheme, loadTheme, saveTheme, type Theme } from './theme'

type ThemeState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: loadTheme(),
  setTheme: (theme) => {
    saveTheme(theme)
    applyTheme(theme)
    set({ theme })
  },
}))
