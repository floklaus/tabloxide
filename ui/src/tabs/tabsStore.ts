import { save } from '@tauri-apps/plugin-dialog'
import { create } from 'zustand'
import { commands, type UiState_Serialize } from '../bindings'
import { toMessage } from '../lib/errors'

export type Tab = {
  id: string
  title: string
  /** Path of the file in the workspace. `null` for a buffer without a file. */
  path: string | null
  content: string
  /** The text of the file on disk. `null` for a buffer without a file. */
  savedContent: string | null
  /** The connection that the tab uses. The tab connects at the first run. */
  connectionId: string | null
  /** The assistant session that the tab shows. Only an assistant tab has it. */
  assistantSessionId?: string
  /** The detail that the tab shows, for example a table. Only a detail tab has it. */
  detail?: Detail
  /**
   * `true` for a preview tab. The next selection in a side view replaces it. Enter,
   * a double click on the tab, or an edit keeps it.
   */
  isPreview?: boolean
}

/** The detail of a row of a side view, in a tab of the editor area. */
export type Detail = { kind: 'table'; schema: string; name: string }

/** A key that is the same for the same detail. */
export function detailKey(detail: Detail): string {
  switch (detail.kind) {
    case 'table':
      return `table:${detail.schema}.${detail.name}`
  }
}

export function isAssistantTab(tab: Tab | undefined): boolean {
  return tab?.assistantSessionId !== undefined
}

/** `true` for a tab with SQL text, not an assistant tab and not a detail tab. */
export function isSqlTab(tab: Tab | undefined): boolean {
  return tab !== undefined && !isAssistantTab(tab) && tab.detail === undefined
}

type TabsState = {
  tabs: Tab[]
  activeId: string | null
  /**
   * The SQL tab that the editor, the results, and the tools use. It is the active
   * tab, or the last active SQL tab while an assistant tab is active.
   */
  sqlId: string | null
  isLoaded: boolean
  error: string | null
  /** Restores the tabs of the last session. Always leaves a minimum of one tab. */
  load: () => Promise<void>
  /** Opens a new tab. Without `title`, the tab gets the next free name. */
  newTab: (content?: string, title?: string) => string
  openFile: (path: string) => Promise<void>
  activate: (id: string) => void
  /** Shows the assistant session in its tab. Opens the tab if necessary. */
  openAssistantTab: (sessionId: string) => void
  /**
   * Shows a detail in a tab. A tab with the same detail becomes active. Else the
   * preview tab gets the detail, or a new preview tab opens. With `keep`, the tab
   * stays: the next selection does not replace it.
   */
  openDetail: (detail: Detail, title: string, keep?: boolean) => void
  /** The tab stays open: the next selection does not replace it. */
  keepTab: (id: string) => void
  /** Closes the preview tab, if there is one. */
  closePreview: () => void
  setContent: (id: string, content: string) => void
  setConnection: (id: string, connectionId: string | null) => void
  /** Saves a tab. A buffer without a file gets a file from the save dialog. */
  save: (id: string) => Promise<void>
  close: (id: string) => void
  /**
   * Reads the file of each tab again. A tab without changes gets the new text.
   * A tab with unsaved changes keeps its text. Git operations change files on disk.
   */
  reloadFromDisk: () => Promise<void>
  setError: (error: string | null) => void
  reset: () => void
}

export function isDirty(tab: Tab): boolean {
  if (!isSqlTab(tab)) return false
  return tab.path === null
    ? tab.content !== ''
    : tab.content !== tab.savedContent
}

/** Tells the user that a save replaces the version that a different program wrote. */
function changedOnDiskMessage(tabs: Tab[]): string {
  const names = tabs.map((tab) => tab.title).join(', ')
  return `A different program changed these files on disk: ${names}. The tabs keep your text. If you save a tab, you replace the version on disk.`
}

function fileName(path: string): string {
  return path.split('/').at(-1) ?? path
}

function nextTitle(tabs: Tab[]): string {
  const used = new Set(
    tabs.filter((tab) => isSqlTab(tab)).map((tab) => tab.title),
  )
  let number = 1
  while (used.has(`Query ${number}`)) number += 1
  return `Query ${number}`
}

function makeTab(tabs: Tab[], content = '', title?: string): Tab {
  return {
    id: crypto.randomUUID(),
    title: title ?? nextTitle(tabs),
    path: null,
    content,
    savedContent: null,
    connectionId: null,
  }
}

/**
 * Converts the tabs to the form that the backend stores. The assistant tabs are not
 * stored, because their sessions are only in memory.
 */
export function toUiState(
  tabs: Tab[],
  activeId: string | null,
): UiState_Serialize {
  const sqlTabs = tabs.filter((tab) => isSqlTab(tab))
  return {
    active_tab: sqlTabs.some((tab) => tab.id === activeId) ? activeId : null,
    tabs: sqlTabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      path: tab.path,
      // A file tab without changes gets its text from the file at the next start.
      content: tab.path !== null && !isDirty(tab) ? null : tab.content,
      connection_id: tab.connectionId,
    })),
  }
}

type StoredTab = UiState_Serialize['tabs'][number]

/** Restores one tab. Returns `null` if its file is not readable and it has no unsaved text. */
async function restoreTab(stored: StoredTab): Promise<Tab | null> {
  const base = {
    id: stored.id,
    title: stored.title,
    connectionId: stored.connection_id,
  }
  if (stored.path === null) {
    return {
      ...base,
      path: null,
      content: stored.content ?? '',
      savedContent: null,
    }
  }
  const file = await commands.fileRead(stored.path)
  if (file.status === 'ok') {
    const content = stored.content ?? file.data
    return { ...base, path: stored.path, content, savedContent: file.data }
  }
  if (stored.content === null) return null
  // The file is gone, but the unsaved text is not. Keep the text in a buffer without a file.
  return { ...base, path: null, content: stored.content, savedContent: null }
}

const INITIAL = {
  tabs: [] as Tab[],
  activeId: null as string | null,
  sqlId: null as string | null,
  isLoaded: false,
  error: null as string | null,
}

/** The state change that makes the tab `id` active. */
function activation(tabs: Tab[], id: string, sqlId: string | null) {
  const tab = tabs.find((item) => item.id === id)
  return { activeId: id, sqlId: tab && isSqlTab(tab) ? id : sqlId }
}

export const useTabsStore = create<TabsState>((set, get) => {
  const update = (id: string, change: Partial<Tab>) =>
    set({
      tabs: get().tabs.map((tab) =>
        tab.id === id ? { ...tab, ...change } : tab,
      ),
    })

  const saveAs = async (tab: Tab): Promise<string | null> => {
    const selected = await save({
      defaultPath: `${tab.title}.sql`,
      filters: [{ name: 'SQL', extensions: ['sql'] }],
    })
    if (!selected) return null
    const relative = await commands.fileRelativePath(selected)
    if (relative.status === 'error') {
      set({
        error: `${relative.error.message} Save the file in the workspace folder.`,
      })
      return null
    }
    return relative.data
  }

  return {
    ...INITIAL,

    load: async () => {
      let restored: Tab[] = []
      let activeId: string | null = null
      try {
        const result = await commands.uiStateLoad()
        if (result.status === 'ok') {
          const tabs = await Promise.all(result.data.tabs.map(restoreTab))
          restored = tabs.filter((tab) => tab !== null)
          activeId = result.data.active_tab
        } else {
          set({ error: result.error.message })
        }
      } catch (error) {
        set({ error: toMessage(error) })
      }
      const tabs = restored.length > 0 ? restored : [makeTab([])]
      const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0]
      set({ tabs, activeId: active.id, sqlId: active.id, isLoaded: true })
    },

    newTab: (content = '', title) => {
      const tab = makeTab(get().tabs, content, title)
      set({ tabs: [...get().tabs, tab], activeId: tab.id, sqlId: tab.id })
      return tab.id
    },

    openFile: async (path) => {
      const open = get().tabs.find((tab) => tab.path === path)
      if (open) {
        set({ activeId: open.id, sqlId: open.id })
        return
      }
      try {
        const file = await commands.fileRead(path)
        if (file.status === 'error') {
          set({ error: file.error.message })
          return
        }
        const tab: Tab = {
          ...makeTab(get().tabs),
          title: fileName(path),
          path,
          content: file.data,
          savedContent: file.data,
        }
        set({
          tabs: [...get().tabs, tab],
          activeId: tab.id,
          sqlId: tab.id,
          error: null,
        })
      } catch (error) {
        set({ error: toMessage(error) })
      }
    },

    activate: (id) => {
      const { tabs, sqlId } = get()
      if (tabs.some((tab) => tab.id === id)) set(activation(tabs, id, sqlId))
    },

    openAssistantTab: (sessionId) => {
      const { tabs } = get()
      const open = tabs.find((tab) => tab.assistantSessionId === sessionId)
      if (open) {
        set({ activeId: open.id })
        return
      }
      const tab: Tab = {
        id: `assistant-${sessionId}`,
        title: 'Assistant',
        path: null,
        content: '',
        savedContent: null,
        connectionId: null,
        assistantSessionId: sessionId,
      }
      set({ tabs: [...tabs, tab], activeId: tab.id })
    },

    openDetail: (detail, title, keep = false) => {
      const { tabs, activeId, sqlId } = get()
      const key = detailKey(detail)
      const same = tabs.find(
        (tab) => tab.detail && detailKey(tab.detail) === key,
      )
      if (same) {
        const next = tabs.map((tab) =>
          tab.id === same.id && keep ? { ...tab, isPreview: false } : tab,
        )
        set({ tabs: next, ...activation(next, same.id, sqlId) })
        return
      }
      const preview = tabs.find((tab) => tab.isPreview)
      if (preview) {
        const next = tabs.map((tab) =>
          tab.id === preview.id
            ? { ...tab, detail, title, isPreview: !keep }
            : tab,
        )
        set({ tabs: next, ...activation(next, preview.id, sqlId) })
        return
      }
      const tab: Tab = {
        id: `detail-${crypto.randomUUID()}`,
        title,
        path: null,
        content: '',
        savedContent: null,
        connectionId: null,
        detail,
        isPreview: !keep,
      }
      // The new tab opens next to the active tab.
      const index = tabs.findIndex((item) => item.id === activeId)
      const next = [...tabs.slice(0, index + 1), tab, ...tabs.slice(index + 1)]
      set({ tabs: next, ...activation(next, tab.id, sqlId) })
    },

    keepTab: (id) =>
      set({
        tabs: get().tabs.map((tab) =>
          tab.id === id ? { ...tab, isPreview: false } : tab,
        ),
      }),

    closePreview: () => {
      const preview = get().tabs.find((tab) => tab.isPreview)
      if (preview) get().close(preview.id)
    },

    setContent: (id, content) => update(id, { content }),
    setConnection: (id, connectionId) => update(id, { connectionId }),

    save: async (id) => {
      const tab = get().tabs.find((item) => item.id === id)
      if (!tab) return
      try {
        const path = tab.path ?? (await saveAs(tab))
        if (path === null) return
        const { content } = tab
        const result = await commands.fileWrite(path, content)
        if (result.status === 'error') {
          set({ error: result.error.message })
          return
        }
        // The user can type during the write. Only the written text is the saved text.
        update(id, { path, title: fileName(path), savedContent: content })
        set({ error: null })
      } catch (error) {
        set({ error: toMessage(error) })
      }
    },

    close: (id) => {
      const { tabs, activeId, sqlId } = get()
      const index = tabs.findIndex((tab) => tab.id === id)
      if (index < 0) return
      const remaining = tabs.filter((tab) => tab.id !== id)
      // The editor always has a minimum of one SQL tab.
      const next = remaining.some((tab) => isSqlTab(tab))
        ? remaining
        : [...remaining, makeTab([])]
      const neighbour = next[Math.min(index, next.length - 1)]
      const nextActive =
        activeId === id ? neighbour.id : (activeId ?? neighbour.id)
      const sqlTabs = next.filter((tab) => isSqlTab(tab))
      const nextSql =
        sqlId !== id && sqlTabs.some((tab) => tab.id === sqlId)
          ? sqlId
          : (
              sqlTabs[Math.min(sqlTabs.length - 1, Math.max(0, index - 1))] ??
              sqlTabs[0]
            ).id
      set({ tabs: next, ...activation(next, nextActive, nextSql) })
    },

    reloadFromDisk: async () => {
      const fileTabs = get().tabs.filter((tab) => tab.path !== null)
      const reads = await Promise.all(
        fileTabs.map(async (tab) => {
          try {
            const file = await commands.fileRead(tab.path ?? '')
            return file.status === 'ok' ? { id: tab.id, text: file.data } : null
          } catch {
            // A file that is not readable now keeps its tab and its text.
            return null
          }
        }),
      )
      const texts = new Map(
        reads
          .filter((read) => read !== null)
          .map((read) => [read.id, read.text]),
      )
      // A tab with unsaved changes keeps its text when its file changed on disk.
      const kept = get().tabs.filter((tab) => {
        const text = texts.get(tab.id)
        return text !== undefined && isDirty(tab) && text !== tab.savedContent
      })
      set({
        tabs: get().tabs.map((tab) => {
          const text = texts.get(tab.id)
          if (text === undefined) return tab
          const content = isDirty(tab) ? tab.content : text
          return { ...tab, content, savedContent: text }
        }),
        ...(kept.length > 0 && { error: changedOnDiskMessage(kept) }),
      })
    },

    setError: (error) => set({ error }),
    reset: () => set(INITIAL),
  }
})

/** Time without a change before the application stores the tabs. */
const PERSIST_DELAY_MS = 400

/**
 * Stores the tabs in the backend after each change, so that the next start restores them.
 * Returns a function that stops the subscription and stores the last change immediately.
 */
export function persistTabs(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const store = () => {
    timer = null
    const { tabs, activeId, isLoaded } = useTabsStore.getState()
    if (!isLoaded) return
    commands.uiStateSave(toUiState(tabs, activeId)).then(
      (result) => {
        if (result.status === 'error') {
          useTabsStore.setState({ error: result.error.message })
        }
      },
      (error: unknown) => useTabsStore.setState({ error: toMessage(error) }),
    )
  }
  const unsubscribe = useTabsStore.subscribe((state, previous) => {
    if (state.tabs === previous.tabs && state.activeId === previous.activeId)
      return
    if (timer) clearTimeout(timer)
    timer = setTimeout(store, PERSIST_DELAY_MS)
  })
  return () => {
    unsubscribe()
    if (timer) {
      clearTimeout(timer)
      store()
    }
  }
}

/**
 * Returns the SQL tab that the editor and the tools use: the `sqlId` tab, else the
 * active tab if it is a SQL tab, else the first SQL tab.
 */
export function sqlTabOf(
  state: Pick<TabsState, 'tabs' | 'activeId' | 'sqlId'>,
): Tab | undefined {
  const sqlTabs = state.tabs.filter((tab) => isSqlTab(tab))
  return (
    sqlTabs.find((tab) => tab.id === state.sqlId) ??
    sqlTabs.find((tab) => tab.id === state.activeId) ??
    sqlTabs[0]
  )
}

/** Returns the SQL tab that the editor and the tools use. */
export function sqlTabForTools(): Tab | undefined {
  return sqlTabOf(useTabsStore.getState())
}

/** Returns the identifier of the SQL tab that the editor and the tools use. */
export function sqlTabIdOf(
  state: Pick<TabsState, 'tabs' | 'activeId' | 'sqlId'>,
): string | null {
  return sqlTabOf(state)?.id ?? null
}
