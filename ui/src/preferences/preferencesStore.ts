import { create } from 'zustand'
import { commands, type Preferences_Serialize } from '../bindings'
import { toMessage } from '../lib/errors'

export type Preferences = Preferences_Serialize

/** The same defaults as the backend. The UI uses them until the backend answers. */
export const DEFAULT_PREFERENCES: Preferences = {
  editor: { font_size: 14, tab_width: 2, line_numbers: true, word_wrap: false },
  history_retention_days: 90,
  guardrails: { development: 'risky', staging: 'risky', production: 'always' },
  assistant: { model: 'claude-opus-5-5', rows_for_ai: 100 },
  check_for_updates: true,
}

export const LIMITS = {
  fontSize: { min: 10, max: 32 },
  tabWidth: { min: 1, max: 8 },
  historyRetentionDays: { min: 1, max: 3650 },
  rowsForAi: { min: 1, max: 1000 },
}

type PreferencesState = {
  preferences: Preferences
  error: string | null
  load: () => Promise<void>
  /** Stores the preferences. The backend puts each value in its permitted range. */
  save: (preferences: Preferences) => Promise<void>
}

export const usePreferencesStore = create<PreferencesState>((set) => {
  const apply = async (
    command: () => ReturnType<typeof commands.preferencesLoad>,
  ) => {
    try {
      const result = await command()
      if (result.status === 'ok') set({ preferences: result.data, error: null })
      else set({ error: result.error.message })
    } catch (error) {
      set({ error: toMessage(error) })
    }
  }
  return {
    preferences: DEFAULT_PREFERENCES,
    error: null,
    load: () => apply(() => commands.preferencesLoad()),
    save: (preferences) => apply(() => commands.preferencesSave(preferences)),
  }
})
