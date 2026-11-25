import { useRef, type KeyboardEvent } from 'react'
import { panelId, tabId } from './preferencesTabIds'

export type PreferencesTab = {
  id: string
  label: string
}

type Props = {
  tabs: readonly PreferencesTab[]
  selected: string
  onSelect: (id: string) => void
}

/** The keys that move the selection, and the index that each key gives. */
function nextIndex(key: string, index: number, count: number): number | null {
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
 * The tab list of the Preferences dialog. Only the selected tab is in the Tab
 * order. The arrow keys, Home, and End select a different tab.
 */
export function PreferencesTabs({ tabs, selected, onSelect }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === selected)
    const next = nextIndex(event.key, index, tabs.length)
    if (next === null) return
    event.preventDefault()
    const tab = tabs[next]
    onSelect(tab.id)
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${tabId(tab.id)}`)
      ?.focus()
  }

  return (
    <div
      ref={listRef}
      className="preferences__tabs"
      role="tablist"
      aria-label="Preference groups"
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const isSelected = tab.id === selected
        return (
          <button
            key={tab.id}
            id={tabId(tab.id)}
            type="button"
            role="tab"
            className="preferences__tab"
            aria-selected={isSelected}
            aria-controls={panelId(tab.id)}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
