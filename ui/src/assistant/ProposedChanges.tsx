import { activeEditor } from '../editor/editorBridge'
import { sqlTabOf, useTabsStore } from '../tabs/tabsStore'
import { useSession } from './sessionContext'
import { proposedBlocks } from './sessionText'

/** The SQL of the last answer, with the actions that put it into a tab. */
export function ProposedChanges() {
  const messages = useSession((state) => state.messages)
  const sqlTab = useTabsStore(sqlTabOf)
  const blocks = proposedBlocks(messages)

  const insert = (code: string) => {
    if (!sqlTab) return
    useTabsStore.getState().activate(sqlTab.id)
    activeEditor()?.insertText(`${code}\n`)
  }

  return (
    <section className="session__changes" aria-labelledby="session-changes">
      <h3 id="session-changes" className="session__heading">
        Proposed changes
      </h3>
      <p className="pane__hint">
        Nothing runs until you insert the SQL into a tab and run it yourself.
      </p>
      {blocks.length === 0 && (
        <p className="pane__hint">The last answer has no SQL.</p>
      )}
      {blocks.map((code, index) => (
        <div key={index} className="session__change">
          <p className="session__change-title">SQL {index + 1}</p>
          {/* The block can scroll. The keyboard needs the focus to scroll it. */}
          <pre className="session__diff" tabIndex={0}>
            {code.split('\n').map((line, number) => (
              <span key={number} className="session__diff-line">
                {`+ ${line}`}
                {'\n'}
              </span>
            ))}
          </pre>
          <div className="session__change-actions">
            <button
              type="button"
              className="button button--small button--primary"
              onClick={() => useTabsStore.getState().newTab(`${code}\n`)}
            >
              Open in a new tab
            </button>
            {sqlTab && (
              <button
                type="button"
                className="button button--small"
                onClick={() => insert(code)}
              >
                Insert into {sqlTab.title}
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  )
}
