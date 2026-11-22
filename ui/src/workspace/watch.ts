import { Channel } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { commands } from '../bindings'
import { useGitStore } from '../git/gitStore'
import { toMessage } from '../lib/errors'
import { invalidateSnippets } from '../snippets/snippets'
import { useTabsStore } from '../tabs/tabsStore'

type ChangeState = {
  /** Number of change reports. A component reads its data again when this changes. */
  count: number
}

/** Counts the reports of changes that a different program made in the workspace folder. */
export const useWorkspaceChangeStore = create<ChangeState>(() => ({
  count: 0,
}))

/** Reads again the data that a change in the workspace folder can make out of date. */
export function onWorkspaceChange(): void {
  useWorkspaceChangeStore.setState((state) => ({ count: state.count + 1 }))
  void useTabsStore.getState().reloadFromDisk()
  // A snippet file can be new or changed.
  invalidateSnippets()
  void useGitStore.getState().refreshAfterExternalChange()
}

/**
 * Starts the watch of the workspace folder. The watch stops when the workspace closes.
 * Returns an error message if the operating system cannot watch the folder.
 */
export async function startWorkspaceWatch(): Promise<string | null> {
  try {
    const channel = new Channel<null>(onWorkspaceChange)
    const result = await commands.workspaceWatch(channel)
    return result.status === 'ok' ? null : result.error.message
  } catch (error) {
    return toMessage(error)
  }
}
