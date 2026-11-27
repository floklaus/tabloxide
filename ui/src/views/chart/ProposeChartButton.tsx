import { useState, type FormEvent } from 'react'
import { runAiAction } from '../../assistant/assistantStore'
import { Modal } from '../../connections/Modal'
import { activeQueryStore } from '../../query/queryStore'
import type { Column } from '../../results/gridModel'
import { Icon } from '../../shell/icons'
import { chartOfSession, proposeChartRequest } from './chartAi'
import type { ChartSettings } from './chartSettings'

type Props = {
  columns: Column[]
  /** Gives the chart the settings that the AI proposed, after they passed each check. */
  onSettings: (settings: ChartSettings) => void
}

function notify(text: string): void {
  activeQueryStore().getState().setNotice(text)
}

function columnsText(count: number): string {
  return count === 1 ? '1 column' : `${count} columns`
}

/**
 * "Propose a chart": the AI gets the names and the types of the columns and the
 * question of the user, and no rows. The application checks the chart settings
 * of the answer against the columns before it uses them. The fixed rules of the
 * suggested charts need no AI. This action is an addition to them.
 */
export function ProposeChartButton({ columns, onSettings }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [question, setQuestion] = useState('')

  const send = async (event: FormEvent) => {
    event.preventDefault()
    setIsOpen(false)
    const session = await runAiAction(proposeChartRequest(columns, question))
    // Without an API key, no request goes. The assistant panel shows the setup.
    if (!session) return
    const chart = chartOfSession(session, columns)
    if ('error' in chart) {
      notify(
        `The chart did not change. ${chart.error} The answer is in the assistant panel.`,
      )
      return
    }
    onSettings(chart.settings)
    setQuestion('')
    notify(
      'The chart has the settings that the AI proposed. The answer is in the assistant panel.',
    )
  }

  return (
    <>
      <button
        type="button"
        className="button button--small ai-action"
        title="The AI proposes a chart. The request sends the names and the types of the columns. It sends no rows."
        onClick={() => setIsOpen(true)}
      >
        <Icon name="sparkle" size={14} />
        Propose a chart
      </button>
      {isOpen && (
        <Modal title="Propose a chart" onClose={() => setIsOpen(false)}>
          <form className="rows-confirm" onSubmit={(event) => void send(event)}>
            <p>
              The request sends your question, and the names and the types of
              the {columnsText(columns.length)} of this result. It sends no
              rows.
            </p>
            <label className="field">
              <span className="field__label">
                What do you want to see? (optional)
              </span>
              <textarea
                rows={3}
                value={question}
                placeholder="For example: the revenue of each month, one line for each country"
                onChange={(event) => setQuestion(event.target.value)}
              />
            </label>
            <p className="field__hint">
              Tabloxide checks the answer against the columns of the result. It
              uses only chart settings that fit the result.
            </p>
            <div className="modal__actions">
              <button
                type="button"
                className="button"
                onClick={() => setIsOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="button button--primary">
                Send
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
