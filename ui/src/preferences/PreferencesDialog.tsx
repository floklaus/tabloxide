import { ConnectorsSettings } from '../engines/ConnectorsSettings'
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { ApiKeyField } from '../assistant/ApiKeyField'
import { UpdateSettings } from '../updates/UpdateSettings'
import { useAssistantStore } from '../assistant/assistantStore'
import type { AssistantModel, ConfirmRule, Environment } from '../bindings'
import { Modal } from '../connections/Modal'
import { allLayouts, useShellStore } from '../shell/shellStore'
import { useThemeStore } from '../theme/themeStore'
import { AppearanceSettings, type Appearance } from './AppearanceSettings'
import { PreferencesTabs } from './PreferencesTabs'
import { panelId, tabId } from './preferencesTabIds'
import {
  LIMITS,
  usePreferencesStore,
  type Preferences,
} from './preferencesStore'

type Props = { onClose: () => void }

/** Applies the theme, the density, and the layout. Each of them is stored on this machine. */
function applyAppearance(appearance: Appearance): void {
  useThemeStore.getState().setTheme(appearance.theme)
  const shell = useShellStore.getState()
  shell.setDensity(appearance.density)
  if (appearance.layout !== null && appearance.layout !== shell.layoutId) {
    shell.applyLayout(appearance.layout)
  }
}

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

const TABS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'confirm', label: 'Ask before a run' },
  { id: 'assistant', label: 'AI assistant' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'updates', label: 'Updates' },
] as const

type TabId = (typeof TABS)[number]['id']

type PanelProps = { id: TabId; selected: TabId; children: ReactNode }

/** A tab panel. A panel that is not selected stays in the form, but is hidden. */
function Panel({ id, selected, children }: PanelProps) {
  return (
    <div
      id={panelId(id)}
      role="tabpanel"
      className="preferences__panel"
      aria-labelledby={tabId(id)}
      data-tab={id}
      hidden={id !== selected}
    >
      {children}
    </div>
  )
}

export function PreferencesDialog({ onClose }: Props) {
  const [tab, setTab] = useState<TabId>('appearance')
  const stored = usePreferencesStore((state) => state.preferences)
  const save = usePreferencesStore((state) => state.save)
  const [draft, setDraft] = useState<Preferences>(stored)
  const [appearance, setAppearance] = useState<Appearance>(() => ({
    theme: useThemeStore.getState().theme,
    density: useShellStore.getState().density,
    layout: useShellStore.getState().layoutId,
  }))
  const setEditor = (change: Partial<Preferences['editor']>) =>
    setDraft({ ...draft, editor: { ...draft.editor, ...change } })

  useEffect(() => {
    void useAssistantStore.getState().loadStatus()
  }, [])

  // A field that is not valid can be on a hidden tab. Then the dialog selects that
  // tab and shows the message of the browser. Only the first field that is not
  // valid selects a tab. The invalid event does not bubble, and React does not
  // give it to the form. Thus a native listener in the capture phase gets it.
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const form = formRef.current
    if (!form) return
    const showInvalid = (event: Event) => {
      const field = event.target as HTMLInputElement
      // A fieldset that contains such a field also matches :invalid.
      const first = form.querySelector(
        'input:invalid, select:invalid, textarea:invalid',
      )
      if (first !== field) return
      const panel = field.closest<HTMLElement>('[role="tabpanel"]')
      const id = panel?.dataset.tab as TabId | undefined
      if (!id || !panel?.hidden) return
      setTab(id)
      setTimeout(() => field.reportValidity())
    }
    form.addEventListener('invalid', showInvalid, true)
    return () => form.removeEventListener('invalid', showInvalid, true)
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await save(draft)
    applyAppearance(appearance)
    onClose()
  }

  return (
    <Modal title="Preferences" onClose={onClose} isWide hasCloseButton>
      <form
        className="preferences"
        onSubmit={(event) => void submit(event)}
        ref={formRef}
      >
        <PreferencesTabs
          tabs={TABS}
          selected={tab}
          onSelect={(id) => setTab(id as TabId)}
        />
        <Panel id="appearance" selected={tab}>
          <AppearanceSettings
            value={appearance}
            layouts={allLayouts(useShellStore.getState().customLayouts)}
            onChange={setAppearance}
          />
        </Panel>
        <Panel id="editor" selected={tab}>
          <fieldset className="form__group">
            <legend>Editor</legend>
            <div className="form__grid form__grid--three">
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
              <NumberField
                label="Keep the query history (days)"
                value={draft.history_retention_days}
                limits={LIMITS.historyRetentionDays}
                onChange={(history_retention_days) =>
                  setDraft({ ...draft, history_retention_days })
                }
              />
              <NumberField
                label="Offer the plan after a query of (ms)"
                value={draft.slow_query_ms}
                limits={LIMITS.slowQueryMs}
                onChange={(slow_query_ms) =>
                  setDraft({ ...draft, slow_query_ms })
                }
              />
            </div>
            <div className="form__checks">
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
            </div>
          </fieldset>
        </Panel>
        <Panel id="confirm" selected={tab}>
          <fieldset className="form__group">
            <legend>Ask before a run</legend>
            <p className="field__hint">
              A destructive statement removes or changes data or structure,
              writes files, or loads an extension.
            </p>
            <div className="form__grid form__grid--three">
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
                          [environment.value]: event.target
                            .value as ConfirmRule,
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
        </Panel>
        <Panel id="assistant" selected={tab}>
          <fieldset className="form__group">
            <legend>AI assistant</legend>
            <p className="field__hint">
              The assistant sends each request to the Claude API of Anthropic.
              The account of the API key pays for the requests.
            </p>
            <div className="form__grid form__grid--two">
              <label className="field">
                <span className="field__label">Model</span>
                <select
                  value={draft.assistant.model}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      assistant: {
                        ...draft.assistant,
                        model: event.target.value as AssistantModel,
                      },
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
            <div className="form__grid form__grid--two">
              <NumberField
                label="Rows for “Ask about these rows”"
                value={draft.assistant.rows_for_ai}
                limits={LIMITS.rowsForAi}
                onChange={(rows_for_ai) =>
                  setDraft({
                    ...draft,
                    assistant: { ...draft.assistant, rows_for_ai },
                  })
                }
              />
              <p className="field__hint">
                The other AI actions send no rows. A production connection never
                sends rows, and no setting changes this.
              </p>
            </div>
          </fieldset>
        </Panel>
        <Panel id="connectors" selected={tab}>
          <ConnectorsSettings />
        </Panel>
        <Panel id="updates" selected={tab}>
          <UpdateSettings
            isEnabled={draft.check_for_updates}
            onChange={(isEnabled) =>
              setDraft({ ...draft, check_for_updates: isEnabled })
            }
          />
        </Panel>
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
