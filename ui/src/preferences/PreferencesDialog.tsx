import { useState, type FormEvent } from 'react'
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

export function PreferencesDialog({ onClose }: Props) {
  const stored = usePreferencesStore((state) => state.preferences)
  const save = usePreferencesStore((state) => state.save)
  const [draft, setDraft] = useState<Preferences>(stored)
  const setEditor = (change: Partial<Preferences['editor']>) =>
    setDraft({ ...draft, editor: { ...draft.editor, ...change } })

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
