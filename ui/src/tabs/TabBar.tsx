import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ConfirmDialog } from '../connections/ConfirmDialog'
import { disposeQueryStore } from '../query/queryStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { isDirty, useTabsStore, type Tab } from './tabsStore'

const NO_CONNECTIONS: never[] = []

/** Returns the index of the tab that a navigation key selects, or `null` for other keys. */
function targetIndex(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count
    case 'ArrowLeft':
      return (index - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * The tabs of the editor. The keyboard behaviour is that of the ARIA tabs pattern:
 * the arrow keys, `Home`, and `End` move between the tabs, and `Delete` closes a tab.
 */
export function TabBar() {
  const tabs = useTabsStore((state) => state.tabs)
  const activeId = useTabsStore((state) => state.activeId)
  const activate = useTabsStore((state) => state.activate)
  const newTab = useTabsStore((state) => state.newTab)
  const close = useTabsStore((state) => state.close)
  const [closing, setClosing] = useState<Tab | null>(null)
  const connections = useWorkspaceStore(
    (state) => state.workspace?.connections ?? NO_CONNECTIONS,
  )
  const connectionName = (tab: Tab) =>
    connections.find((item) => item.id === tab.connectionId)?.name
  const hintId = useId()
  const tabElements = useRef(new Map<string, HTMLButtonElement>())
  // After the keyboard closed a tab, the focus goes to the tab that is active then.
  const isKeyboardClose = useRef(false)
  const needsFocus = useRef(false)

  useEffect(() => {
    if (!needsFocus.current) return
    needsFocus.current = false
    if (activeId) tabElements.current.get(activeId)?.focus()
  }, [activeId, tabs])

  const closeNow = (tab: Tab) => {
    needsFocus.current = isKeyboardClose.current
    disposeQueryStore(tab.id)
    close(tab.id)
    setClosing(null)
  }
  const requestClose = (tab: Tab, fromKeyboard: boolean) => {
    isKeyboardClose.current = fromKeyboard
    if (isDirty(tab)) setClosing(tab)
    else closeNow(tab)
  }

  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === 'Delete') {
      event.preventDefault()
      requestClose(tabs[index], true)
      return
    }
    const target = targetIndex(event.key, index, tabs.length)
    if (target === null) return
    event.preventDefault()
    const next = tabs[target]
    activate(next.id)
    tabElements.current.get(next.id)?.focus()
  }

  // Only one tab is in the Tab key sequence. The arrow keys move between the tabs.
  const focusableId = activeId ?? tabs[0]?.id

  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist" aria-label="Editor tabs">
        {tabs.map((tab, index) => {
          const dirty = isDirty(tab)
          return (
            <div
              key={tab.id}
              className="tabs__tab"
              role="presentation"
              data-active={tab.id === activeId}
            >
              <button
                type="button"
                role="tab"
                className="tabs__title"
                ref={(element) => {
                  if (element) tabElements.current.set(tab.id, element)
                  else tabElements.current.delete(tab.id)
                }}
                tabIndex={tab.id === focusableId ? 0 : -1}
                aria-selected={tab.id === activeId}
                aria-describedby={hintId}
                title={tab.path ?? tab.title}
                onClick={() => activate(tab.id)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                {tab.title}
                {connectionName(tab) && (
                  <span className="tabs__connection">
                    {' '}
                    — {connectionName(tab)}
                  </span>
                )}
                {dirty && (
                  <span className="tabs__dirty" aria-label="Unsaved changes">
                    {' '}
                    ●
                  </span>
                )}
              </button>
              {/* A tab list can contain only tabs. Thus this button is for the pointer
                  only, and the Delete key closes a tab from the keyboard. */}
              <button
                type="button"
                className="tabs__close"
                tabIndex={-1}
                aria-hidden="true"
                title={`Close ${tab.title} (Delete)`}
                // The button must not get the focus, because a screen reader
                // cannot see it. The focus stays where it was.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => requestClose(tab, false)}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      <span id={hintId} className="visually-hidden">
        Press Delete to close the tab.
      </span>
      <button
        type="button"
        className="tabs__new"
        aria-label="New query tab"
        title="New query tab"
        onClick={() => newTab()}
      >
        +
      </button>
      {closing && (
        <ConfirmDialog
          title="Close the tab?"
          message={`"${closing.title}" has changes that are not saved. If you close the tab, you lose these changes.`}
          confirmLabel="Close without saving"
          onConfirm={() => closeNow(closing)}
          onCancel={() => setClosing(null)}
        />
      )}
    </div>
  )
}
