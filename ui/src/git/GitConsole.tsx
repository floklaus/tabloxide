import { useEffect, useRef, type KeyboardEvent } from 'react'
import { AiAction } from '../assistant/AiAction'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { lastOutput, useConsoleStore, type ConsoleEntry } from './consoleStore'

function Output({ entry }: { entry: ConsoleEntry }) {
  const confirm = useConsoleStore((state) => state.confirm)
  const decline = useConsoleStore((state) => state.decline)
  const { state } = entry
  switch (state.type) {
    case 'running':
      return (
        <p className="console__status" role="status">
          Running…
        </p>
      )
    case 'done': {
      const { output } = state
      return (
        <>
          {output.is_cut && (
            <p className="console__status">
              The output is longer than 1 MB. The console shows its end.
            </p>
          )}
          {output.stdout && (
            <pre className="console__output">{output.stdout}</pre>
          )}
          {output.stderr && (
            <pre
              className={`console__output ${output.is_success ? '' : 'console__output--error'}`}
            >
              {output.stderr}
            </pre>
          )}
          {output.is_cancelled && (
            <p className="console__status">You stopped the command.</p>
          )}
          {output.note && <p className="console__refused">{output.note}</p>}
        </>
      )
    }
    case 'refused':
      return <p className="console__refused">Not run. {state.reason}</p>
    case 'failed':
      return <p className="console__refused">{state.message}</p>
    case 'not-run':
      return <p className="console__status">Not run.</p>
    case 'confirm':
      return (
        <div
          className="console__confirm"
          role="alertdialog"
          aria-label="Run a command that removes work?"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
            <path
              d="M12 8v5 M12 16.5h.01 M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"
              stroke="currentColor"
              strokeWidth="1.75"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="console__effect">{state.effect}</span>
          <button
            type="button"
            className="button button--small"
            onClick={() => decline(entry.id)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button--small button--danger"
            onClick={() => void confirm(entry.id)}
          >
            Run
          </button>
        </div>
      )
  }
}

/**
 * The Git console: one Git command at a time, in the root of the repository of the
 * workspace. It runs no shell.
 */
export function GitConsole() {
  const entries = useConsoleStore((state) => state.entries)
  const input = useConsoleStore((state) => state.input)
  const options = useConsoleStore((state) => state.options)
  const runningId = useConsoleStore((state) => state.runningId)
  const store = useConsoleStore.getState
  const folder = useWorkspaceStore((state) => state.workspace?.name)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const last = lastOutput(entries)

  useEffect(() => {
    void useConsoleStore.getState().load()
  }, [])

  // The input is not available while a command runs. After the run, it gets the
  // focus again, so that the user can type the next command.
  useEffect(() => {
    if (runningId === null) inputRef.current?.focus()
  }, [runningId])

  // The newest output is at the bottom. The log shows it.
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [entries])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      store().moveInHistory(event.key === 'ArrowUp' ? -1 : 1)
    } else if (event.key === 'Tab' && !event.shiftKey && input.trim()) {
      event.preventDefault()
      store().complete()
    }
  }

  return (
    <section className="console" aria-label="Git console">
      <div className="console__bar">
        <AiAction
          label="Explain the last output"
          disabled={last === null}
          title="The AI explains the last command and its output. The request sends no rows and no structure of the database."
          request={() => ({
            task: 'git-output',
            text: 'Explain the output of this Git command.',
            context: {
              type: 'git-output',
              command: last?.command ?? '',
              output: last?.output ?? '',
            },
          })}
        />
        <button
          type="button"
          className="button button--small"
          disabled={entries.length === 0}
          onClick={() => store().clear()}
        >
          Clear
        </button>
        {runningId !== null && (
          <button
            type="button"
            className="button button--small"
            onClick={() => void store().stop()}
          >
            Stop
          </button>
        )}
      </div>
      <div
        ref={logRef}
        className="console__log"
        role="log"
        aria-label="Git console output"
        tabIndex={0}
      >
        {entries.length === 0 && (
          <p className="pane__hint">
            Type a Git command below, for example status -sb.
          </p>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className="console__entry">
            <div className="console__command">
              <span className="console__git">git</span> {entry.line}
            </div>
            <Output entry={entry} />
          </div>
        ))}
      </div>
      <form
        className="console__form"
        onSubmit={(event) => {
          event.preventDefault()
          void store().submit()
        }}
      >
        <label className="console__input">
          <span className="console__git" aria-hidden="true">
            git
          </span>
          <span className="visually-hidden">Git command</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            spellCheck={false}
            autoComplete="off"
            disabled={runningId !== null}
            onChange={(event) => store().setInput(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </label>
        {options.length > 0 && (
          <p className="console__options" role="status">
            {options.join('  ')}
          </p>
        )}
        <p className="console__hint">
          Runs in the workspace folder {folder ?? ''}. Up and Down select an
          earlier command. Tab completes branch and file names. There is no
          shell: pipes, redirects, and variables do not operate.
        </p>
      </form>
    </section>
  )
}
