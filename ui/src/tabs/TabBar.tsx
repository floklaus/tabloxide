import { useState } from 'react'
import { ConfirmDialog } from '../connections/ConfirmDialog'
import { disposeQueryStore } from '../query/queryStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { isDirty, useTabsStore, type Tab } from './tabsStore'

const NO_CONNECTIONS: never[] = []

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

  const closeNow = (tab: Tab) => {
    disposeQueryStore(tab.id)
    close(tab.id)
    setClosing(null)
  }

  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist" aria-label="Editor tabs">
        {tabs.map((tab) => {
          const dirty = isDirty(tab)
          return (
            <div
              key={tab.id}
              className="tabs__tab"
              data-active={tab.id === activeId}
            >
              <button
                type="button"
                role="tab"
                className="tabs__title"
                aria-selected={tab.id === activeId}
                title={tab.path ?? tab.title}
                onClick={() => activate(tab.id)}
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
              <button
                type="button"
                className="tabs__close"
                aria-label={`Close ${tab.title}`}
                onClick={() => (dirty ? setClosing(tab) : closeNow(tab))}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
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
