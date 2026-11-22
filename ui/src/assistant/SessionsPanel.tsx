import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { Icon } from '../shell/icons'
import { labelOf, useAssistantStore, type SessionEntry } from './assistantStore'
import { DEFAULT_TITLE, sessionDetail } from './sessionLabels'

/** The time between two updates of the relative times. */
const CLOCK_MS = 30_000

function SessionItem(props: {
  entry: SessionEntry
  isActive: boolean
  now: number
}) {
  const { entry, isActive, now } = props
  const state = useStore(entry.store)
  const open = () => {
    useAssistantStore.getState().select(entry.id)
    useAssistantStore.getState().openInTab(entry.id)
  }
  return (
    <li>
      <button
        type="button"
        className="sessions__item"
        aria-current={isActive ? 'true' : undefined}
        onClick={open}
      >
        <span
          className={`sessions__dot sessions__dot--${labelOf(state)}`}
          aria-hidden="true"
        />
        <span className="sessions__text">
          <span className="sessions__title">
            {state.title ?? DEFAULT_TITLE}
          </span>
          <span className="sessions__detail">{sessionDetail(state, now)}</span>
        </span>
      </button>
    </li>
  )
}

/** The sidebar view with the assistant sessions. The newest session is first. */
export function SessionsPanel() {
  const sessions = useAssistantStore((state) => state.sessions)
  const activeId = useAssistantStore((state) => state.activeId)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => clearInterval(timer)
  }, [])

  const newSession = () => {
    const id = useAssistantStore.getState().newSession()
    useAssistantStore.getState().openInTab(id)
  }

  return (
    <section className="sessions" aria-label="Assistant sessions">
      <div className="connections__header">
        <h2 className="pane__title">Sessions</h2>
        <span className="title-bar__spacer" />
        <button
          type="button"
          className="icon-link"
          aria-label="New session"
          title="New session"
          onClick={newSession}
        >
          <Icon name="plus" size={16} />
        </button>
      </div>
      <ul className="sessions__list">
        {[...sessions].reverse().map((entry) => (
          <SessionItem
            key={entry.id}
            entry={entry}
            isActive={entry.id === activeId}
            now={now}
          />
        ))}
      </ul>
    </section>
  )
}
