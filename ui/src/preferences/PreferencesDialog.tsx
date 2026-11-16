import { useEffect, useState, type FormEvent } from 'react'
import { ApiKeyField } from '../assistant/ApiKeyField'
import { useAssistantStore } from '../assistant/assistantStore'
import type { AssistantModel, ConfirmRule, Environment } from '../bindings'
import { Modal } from '../connections/Modal'
import {
  LIMITS,
  usePreferencesStore,
  type Preferences,
} from './preferencesStore'

type Props = { onClose: () => void }

type NumberFieldProps = {
  label: string
  value: number
  limits: { min: number; max: number }
  onChange: (value: number) => void
}

function NumberField({ label, value, limits, onChange }: NumberFieldProps) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        type="number"
        min={limits.min}
        max={limits.max}
        required
        value={value}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
      <span className="field__hint">
        {limits.min} to {limits.max}
      </span>
    </label>
  )
}

const ENVIRONMENTS: { value: Environment; label: string }[] = [
  { value: 'development', label: 'Development connections' },
  { value: 'staging', label: 'Staging connections' },
  { value: 'production', label: 'Production connections' },
]

const CONFIRM_RULES: { value: ConfirmRule; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: 'risky', label: 'Before a destructive statement' },
  { value: 'always', label: 'Before each run' },
]

const MODELS: { value: AssistantModel; label: string }[] = [
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (lower cost)' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (lowest cost)' },
  { value: 'claude-fable-5-2', label: 'Claude Fable 5.2 (highest cost)' },
]

export function PreferencesDialog({ onClose }: Props) {
  const stored = usePreferencesStore((state) => state.preferences)
  const save = usePreferencesStore((state) => state.save)
  const [draft, setDraft] = useState<Preferences>(stored)
  const setEditor = (change: Partial<Preferences['editor']>) =>
    setDraft({ ...draft, editor: { ...draft.editor, ...change } })

  useEffect(() => {
    void useAssistantStore.getState().loadStatus()
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await save(draft)
    onClose()
  }

  return (
    <Modal title="Preferences" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <div className="form__grid">
          <NumberField
            label="Font size (pixels)"
            value={draft.editor.font_size}
            limits={LIMITS.fontSize}
            onChange={(font_size) => setEditor({ font_size })}
          />
          <NumberField
            label="Tab width (spaces)"
            value={draft.editor.tab_width}
            limits={LIMITS.tabWidth}
            onChange={(tab_width) => setEditor({ tab_width })}
          />
          <label className="field field--check">
            <input
              type="checkbox"
              checked={draft.editor.line_numbers}
              onChange={(event) =>
                setEditor({ line_numbers: event.target.checked })
              }
            />
            <span>Show line numbers</span>
          </label>
          <label className="field field--check">
            <input
              type="checkbox"
              checked={draft.editor.word_wrap}
              onChange={(event) =>
                setEditor({ word_wrap: event.target.checked })
              }
            />
            <span>Wrap long lines</span>
          </label>
          <NumberField
            label="Keep the query history (days)"
            value={draft.history_retention_days}
            limits={LIMITS.historyRetentionDays}
            onChange={(history_retention_days) =>
              setDraft({ ...draft, history_retention_days })
            }
          />
        </div>
        <fieldset className="form__group">
          <legend>Ask before a run</legend>
          <p className="field__hint">
            A destructive statement removes or changes data or structure, writes
            files, or loads an extension.
          </p>
          <div className="form__grid">
            {ENVIRONMENTS.map((environment) => (
              <label key={environment.value} className="field">
                <span className="field__label">{environment.label}</span>
                <select
                  value={draft.guardrails[environment.value]}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      guardrails: {
                        ...draft.guardrails,
                        [environment.value]: event.target.value as ConfirmRule,
                      },
                    })
                  }
                >
                  {CONFIRM_RULES.map((rule) => (
                    <option key={rule.value} value={rule.value}>
                      {rule.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="form__group">
          <legend>AI assistant</legend>
          <p className="field__hint">
            The assistant sends each request to the Claude API of Anthropic. The
            account of the API key pays for the requests.
          </p>
          <div className="form__grid">
            <label className="field">
              <span className="field__label">Model</span>
              <select
                value={draft.assistant.model}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    assistant: { model: event.target.value as AssistantModel },
                  })
                }
              >
                {MODELS.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
            <ApiKeyField />
          </div>
        </fieldset>
        <div className="modal__actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}
