import { useEffect } from 'react'
import { Icon } from '../shell/icons'
import { useTabsStore } from '../tabs/tabsStore'
import { ApiKeyField } from './ApiKeyField'
import { useAssistantStore } from './assistantStore'
import { Composer } from './Composer'
import { Conversation } from './Conversation'
import { SessionContext, useSession } from './sessionContext'
import { EMPTY_HINT, PRIVACY_TEXT } from './sessionText'

function PanelBody() {
  const hasKey = useAssistantStore((state) => state.hasKey)
  const activeId = useAssistantStore((state) => state.activeId)
  const status = useSession((state) => state.status)
  const title = useSession((state) => state.title)
  const isBusy = status !== 'idle'
  const hasConversation = title !== null
  // The tab of the session shows the confirmation when it is the active tab.
  const isInActiveTab = useTabsStore(
    (state) =>
      state.tabs.find((tab) => tab.id === state.activeId)
        ?.assistantSessionId === activeId,
  )

  return (
    <section
      className="pane assistant"
      aria-label="Assistant"
      data-area="assistant"
    >
      <div className="assistant__bar">
        <h2 className="pane__title">Assistant</h2>
        <span className="title-bar__spacer" />
        <button
          type="button"
          className="icon-link"
          aria-label="Open the session in a tab"
          title="Open the session in a tab"
          disabled={!hasConversation && !isBusy}
          onClick={() => useAssistantStore.getState().openInTab(activeId)}
        >
          <Icon name="external" size={16} />
        </button>
        <button
          type="button"
          className="icon-link"
          aria-label="New conversation"
          title="New conversation"
          disabled={!hasConversation && !isBusy}
          onClick={() => useAssistantStore.getState().newSession()}
        >
          <Icon name="plus" size={16} />
        </button>
      </div>

      <p className="pane__hint assistant__privacy">{PRIVACY_TEXT}</p>

      {hasKey === false && (
        <div className="assistant__setup">
          <p>The assistant needs an API key.</p>
          <ApiKeyField />
        </div>
      )}

      {hasKey !== false && (
        <>
          <Conversation emptyHint={EMPTY_HINT} />
          <Composer hasConfirm={!isInActiveTab} />
        </>
      )}
    </section>
  )
}

/** The side panel of the AI assistant. It shows the active session. */
export function AssistantPanel() {
  const store = useAssistantStore(
    (state) =>
      (
        state.sessions.find((entry) => entry.id === state.activeId) ??
        state.sessions[0]
      ).store,
  )

  useEffect(() => {
    void useAssistantStore.getState().loadStatus()
  }, [])

  return (
    <SessionContext.Provider value={store}>
      <PanelBody />
    </SessionContext.Provider>
  )
}
