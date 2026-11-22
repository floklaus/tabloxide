import { create } from 'zustand'
import { commands, type UpdateCheck } from '../bindings'
import { toMessage } from '../lib/errors'

export type UpdateState = {
  /** The result of the last check. `null` before the first check. */
  check: UpdateCheck | null
  isChecking: boolean
  isInstalling: boolean
  /** `true` after the user selected "Later". The notice stays hidden until the next start. */
  isDeferred: boolean
  error: string | null
  /** Asks the update server for a newer version. */
  checkNow: () => Promise<void>
  /** Installs the newer version and starts the application again. */
  install: () => Promise<void>
  defer: () => void
  dismissError: () => void
}

const INITIAL = {
  check: null,
  isChecking: false,
  isInstalling: false,
  isDeferred: false,
  error: null,
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  ...INITIAL,

  checkNow: async () => {
    if (get().isChecking || get().isInstalling) return
    set({ isChecking: true, error: null, isDeferred: false })
    try {
      const result = await commands.updateCheck()
      if (result.status === 'ok') set({ check: result.data })
      else set({ error: result.error.message })
    } catch (error) {
      set({ error: toMessage(error) })
    } finally {
      set({ isChecking: false })
    }
  },

  install: async () => {
    if (get().isInstalling) return
    set({ isInstalling: true, error: null })
    try {
      // After a successful install, the application starts again and this call
      // does not return.
      const result = await commands.updateInstall()
      if (result.status === 'error') set({ error: result.error.message })
    } catch (error) {
      set({ error: toMessage(error) })
    } finally {
      set({ isInstalling: false })
    }
  },

  defer: () => set({ isDeferred: true }),
  dismissError: () => set({ error: null }),
}))

/** Sets the store to its initial state. For tests. */
export function resetUpdateStore(): void {
  useUpdateStore.setState(INITIAL)
}
