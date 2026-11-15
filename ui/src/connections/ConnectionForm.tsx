import { open } from '@tauri-apps/plugin-dialog'
import { useState, type FormEvent } from 'react'
import { commands, type Engine, type ValidationIssue } from '../bindings'
import { toMessage } from '../lib/errors'
import {
  runConnectionTest,
  useConnectionStore,
  type TestState,
} from './connectionStore'
import { Field } from './Field'
import {
  isFileEngine,
  issueFor,
  toDraft,
  toProfile,
  withEngine,
  type ConnectionDraft,
  type ConnectionProfile,
} from './formModel'
import { Modal } from './Modal'
import {
  ENGINE_OPTIONS,
  ENVIRONMENT_OPTIONS,
  SECRET_OPTIONS,
  TLS_OPTIONS,
} from './options'
import { TestResult } from './TestResult'

type ConnectionFormProps = {
  profile: ConnectionProfile
  isNew: boolean
  onClose: () => void
}

export function ConnectionForm({
  profile,
  isNew,
  onClose,
}: ConnectionFormProps) {
  const save = useConnectionStore((state) => state.save)
  const [draft, setDraft] = useState<ConnectionDraft>(() => toDraft(profile))
  const [password, setPassword] = useState('')
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testState, setTestState] = useState<TestState>()
  const [isBusy, setIsBusy] = useState(false)

  const update = <K extends keyof ConnectionDraft>(
    key: K,
    value: ConnectionDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }))

  const text = (key: Exclude<keyof ConnectionDraft, 'readOnly'>) => ({
    value: draft[key],
    onChange: (event: { target: { value: string } }) =>
      update(key, event.target.value as never),
  })

  /** Converts the form to a profile. Shows the problems if the form is not valid. */
  const readProfile = (): ConnectionProfile | null => {
    const result = toProfile(draft)
    setIssues(result.ok ? [] : result.issues)
    setSaveError(null)
    return result.ok ? result.profile : null
  }

  const passwordOrNull =
    draft.secretKind === 'keychain' && password !== '' ? password : null

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const next = readProfile()
    if (!next) return
    setIsBusy(true)
    const error = await save(next, passwordOrNull)
    setIsBusy(false)
    if (!error) {
      onClose()
      return
    }
    setIssues(error.issues)
    setSaveError(error.issues.length > 0 ? null : error.message)
  }

  const handleTest = async () => {
    const next = readProfile()
    if (!next) return
    setTestState({ status: 'testing' })
    setTestState(await runConnectionTest(next, passwordOrNull))
  }

  const error = (field: string) => issueFor(issues, field)
  const isFile = isFileEngine(draft.engine)

  /** Lets the user select a database file. A file in the workspace gets a relative path. */
  const chooseFile = async () => {
    try {
      const selected = await open({ directory: false, multiple: false })
      if (typeof selected !== 'string') return
      const relative = await commands.fileRelativePath(selected)
      // A file outside the workspace folder keeps its absolute path.
      update('database', relative.status === 'ok' ? relative.data : selected)
    } catch (failure) {
      setSaveError(toMessage(failure))
    }
  }

  const queryTimeoutField = (
    <Field
      label="Query timeout (seconds)"
      error={error('query_timeout_secs')}
      hint="Empty means no limit."
    >
      {(props) => (
        <input
          {...props}
          type="text"
          inputMode="numeric"
          {...text('queryTimeoutSecs')}
        />
      )}
    </Field>
  )

  return (
    <Modal
      title={isNew ? 'New connection' : 'Edit connection'}
      onClose={onClose}
    >
      <form
        className="form"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
      >
        <div className="form__grid">
          <Field label="Database engine">
            {(props) => (
              <select
                {...props}
                value={draft.engine}
                onChange={(event) =>
                  setDraft((current) =>
                    withEngine(current, event.target.value as Engine),
                  )
                }
              >
                {ENGINE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Name" error={error('name')}>
            {(props) => <input {...props} type="text" {...text('name')} />}
          </Field>
          <Field label="Environment">
            {(props) => (
              <select {...props} {...text('environment')}>
                {ENVIRONMENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {!isFile && (
            <>
              <Field label="Host" error={error('host')}>
                {(props) => <input {...props} type="text" {...text('host')} />}
              </Field>
              <Field label="Port" error={error('port')}>
                {(props) => (
                  <input
                    {...props}
                    type="text"
                    inputMode="numeric"
                    {...text('port')}
                  />
                )}
              </Field>
              <Field label="Database" error={error('database')}>
                {(props) => (
                  <input {...props} type="text" {...text('database')} />
                )}
              </Field>
              <Field label="User" error={error('user')}>
                {(props) => (
                  <input
                    {...props}
                    type="text"
                    autoComplete="off"
                    {...text('user')}
                  />
                )}
              </Field>
            </>
          )}
        </div>

        {isFile && (
          <>
            <Field
              label="Database file"
              error={error('database')}
              hint="A path in the workspace folder, an absolute path, or :memory: for a database in memory. If the file does not exist, the first connection makes it."
            >
              {(props) => (
                <input {...props} type="text" {...text('database')} />
              )}
            </Field>
            <button
              type="button"
              className="button button--small"
              onClick={() => void chooseFile()}
            >
              Select file…
            </button>
          </>
        )}

        {!isFile && (
          <Field label="TLS mode">
            {(props) => (
              <select {...props} {...text('tlsMode')}>
                {TLS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        <label className="field field--check">
          <input
            type="checkbox"
            checked={draft.readOnly}
            onChange={(event) => update('readOnly', event.target.checked)}
          />
          <span>
            Read-only. The database refuses statements that change data or the
            schema.
          </span>
        </label>

        {isFile && queryTimeoutField}
        {!isFile && (
          <>
            <div className="form__grid">
              <Field label="Password source" error={error('secret')}>
                {(props) => (
                  <select {...props} {...text('secretKind')}>
                    {SECRET_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              {draft.secretKind === 'keychain' && (
                <Field
                  label="Password"
                  hint={
                    isNew
                      ? undefined
                      : 'Leave this field empty to keep the stored password.'
                  }
                >
                  {(props) => (
                    <input
                      {...props}
                      type="password"
                      autoComplete="off"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  )}
                </Field>
              )}
              {draft.secretKind === 'env-var' && (
                <Field label="Environment variable name">
                  {(props) => (
                    <input {...props} type="text" {...text('envVarName')} />
                  )}
                </Field>
              )}
            </div>

            <details className="form__advanced">
              <summary>Advanced settings</summary>
              <div className="form__grid">
                <Field
                  label="Socket directory"
                  error={error('socket_path')}
                  hint="Unix socket directory. When it has a value, the host is ignored."
                >
                  {(props) => (
                    <input {...props} type="text" {...text('socketPath')} />
                  )}
                </Field>
                <Field
                  label="Connection timeout (seconds)"
                  error={error('connect_timeout_secs')}
                >
                  {(props) => (
                    <input
                      {...props}
                      type="text"
                      inputMode="numeric"
                      {...text('connectTimeoutSecs')}
                    />
                  )}
                </Field>
                {queryTimeoutField}
              </div>
              <Field
                label="Extra parameters"
                error={error('params')}
                hint="One parameter on each line as name=value."
              >
                {(props) => (
                  <textarea {...props} rows={3} {...text('params')} />
                )}
              </Field>
            </details>
          </>
        )}

        <TestResult state={testState} />
        {saveError && (
          <p className="message message--error" role="alert">
            {saveError}
          </p>
        )}

        <div className="modal__actions">
          <button
            type="button"
            className="button"
            onClick={() => void handleTest()}
            disabled={testState?.status === 'testing'}
          >
            Test connection
          </button>
          <span className="modal__spacer" />
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={isBusy}
          >
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}
