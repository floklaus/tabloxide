import { open } from '@tauri-apps/plugin-dialog'
import { create } from 'zustand'
import {
  commands,
  type RecentWorkspaceInfo as RecentWorkspace,
  type WorkspaceSnapshot_Serialize,
} from '../bindings'
import { toMessage } from '../lib/errors'

export type Workspace = WorkspaceSnapshot_Serialize

type WorkspaceState = {
  workspace: Workspace | null
  recent: RecentWorkspace[]
  isLoading: boolean
  error: string | null
  /** Gets the open workspace and the recent list from the backend. */
  init: () => Promise<void>
  /** Shows the folder selection dialog and opens the selected folder. */
  openFolder: () => Promise<void>
  openPath: (path: string) => Promise<void>
  close: () => Promise<void>
  setWorkspace: (workspace: Workspace) => void
  setError: (error: string | null) => void
}

async function loadRecent(): Promise<RecentWorkspace[]> {
  const result = await commands.workspaceRecent()
  // The recent list is only a convenience. A failure gives an empty list.
  return result.status === 'ok' ? result.data : []
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspace: null,
  recent: [],
  isLoading: true,
  error: null,

  init: async () => {
    try {
      const [workspace, recent] = await Promise.all([
        commands.workspaceCurrent(),
        loadRecent(),
      ])
      set({ workspace, recent, isLoading: false })
    } catch (error) {
      set({ isLoading: false, error: toMessage(error) })
    }
  },

  openFolder: async () => {
    try {
      const path = await open({ directory: true, multiple: false })
      if (typeof path === 'string') await get().openPath(path)
    } catch (error) {
      set({ error: toMessage(error) })
    }
  },

  openPath: async (path) => {
    try {
      const result = await commands.workspaceOpen(path)
      if (result.status === 'error') {
        set({ error: result.error.message })
        return
      }
      set({ workspace: result.data, error: null, recent: await loadRecent() })
    } catch (error) {
      set({ error: toMessage(error) })
    }
  },

  close: async () => {
    try {
      await commands.workspaceClose()
      set({ workspace: null, error: null })
    } catch (error) {
      set({ error: toMessage(error) })
    }
  },

  setWorkspace: (workspace) => set({ workspace }),
  setError: (error) => set({ error }),
}))
