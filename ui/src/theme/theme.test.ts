import { describe, expect, test } from 'vitest'
import { applyTheme, loadTheme, nextTheme, saveTheme } from './theme'

describe('theme', () => {
  test('returns the system theme when storage is empty', () => {
    expect(loadTheme()).toBe('system')
  })

  test('returns the stored theme after a save', () => {
    saveTheme('dark')

    expect(loadTheme()).toBe('dark')
  })

  test('returns the system theme when the stored value is not a theme', () => {
    localStorage.setItem('tabloxide.theme', 'purple')

    expect(loadTheme()).toBe('system')
  })

  test('sets the data-theme attribute for an explicit theme', () => {
    applyTheme('dark')

    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  test('removes the data-theme attribute for the system theme', () => {
    applyTheme('dark')

    applyTheme('system')

    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  test('cycles through all themes and starts again', () => {
    expect(nextTheme('system')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('neon')
    expect(nextTheme('neon')).toBe('high-contrast')
    expect(nextTheme('high-contrast')).toBe('system')
  })
})
