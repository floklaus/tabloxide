import { useState, type FormEvent } from 'react'
import { Modal } from '../../connections/Modal'
import { allLayouts, settingsOf, useShellStore } from '../shellStore'
import { newLayoutId, takeRequestedLayout } from './layoutActions'
import {
  describeSettings,
  EDITOR_SIZE,
  nameProblem,
  normalizeSettings,
  SIDEBAR_WIDTH,
  STANDARD_SETTINGS,
  unusedName,
  type LayoutSettings,
  type Panels,
  type ResultsPosition,
  type SavedLayout,
} from './layoutModel'
import { LayoutPreview } from './LayoutPreview'

type Props = { onClose: () => void }

/** A change of the name, or a question before a deletion, of the selected layout. */
type Pending =
  { kind: 'rename'; name: string; error: string | null } | { kind: 'delete' }

const PANEL_OPTIONS: { key: keyof Panels | 'editor'; label: string }[] = [
  { key: 'sidebar', label: 'Sidebar' },
  { key: 'editor', label: 'Editor' },
  { key: 'results', label: 'Results' },
  { key: 'assistant', label: 'Assistant' },
  { key: 'statusBar', label: 'Status bar' },
]

const RESULTS_OPTIONS: { value: ResultsPosition; label: string }[] = [
  { value: 'beside', label: 'Beside the editor' },
  { value: 'below', label: 'Below the editor' },
  { value: 'tab', label: 'Tab in the editor' },
]

type SizeFieldProps = {
  id: string
  label: string
  value: number
  limits: { min: number; max: number }
  disabled: boolean
  onChange: (value: number) => void
}

function SizeField({
  id,
  label,
  value,
  limits,
  disabled,
  onChange,
}: SizeFieldProps) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={limits.min}
        max={limits.max}
        value={value}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
      <span id={`${id}-hint`} className="field__hint">
        {limits.min} to {limits.max}
      </span>
    </div>
  )
}

/** Shows, makes, changes, and deletes the layouts of the window. */
export function LayoutEditor({ onClose }: Props) {
  const customLayouts = useShellStore((state) => state.customLayouts)
  const layouts = allLayouts(customLayouts)
  const [selectedId, setSelectedId] = useState<string | null>(
    () => takeRequestedLayout() ?? useShellStore.getState().layoutId,
  )
  const selected = layouts.find((layout) => layout.id === selectedId) ?? null
  const [draft, setDraft] = useState<LayoutSettings>(
    () => selected?.settings ?? settingsOf(useShellStore.getState()),
  )
  const [pending, setPending] = useState<Pending | null>(null)
  const isEditable = !selected?.isBuiltIn
  const change = (patch: Partial<LayoutSettings>) =>
    setDraft(normalizeSettings({ ...draft, ...patch }))
  const store = () => useShellStore.getState()

  const select = (layout: SavedLayout) => {
    setSelectedId(layout.id)
    setDraft(layout.settings)
    setPending(null)
  }

  const add = (name: string, settings: LayoutSettings) => {
    const layout: SavedLayout = {
      id: newLayoutId(),
      name,
      settings,
      isBuiltIn: false,
    }
    store().saveLayout(layout)
    select(layout)
  }

  const rename = (event: FormEvent) => {
    event.preventDefault()
    if (!selected || pending?.kind !== 'rename') return
    const error = nameProblem(pending.name, layouts, selected.id)
    if (error) {
      setPending({ ...pending, error })
      return
    }
    store().saveLayout({ ...selected, name: pending.name.trim() })
    setPending(null)
  }

  const remove = () => {
    if (!selected) return
    store().deleteLayout(selected.id)
    select(layouts[0])
  }

  const apply = () => store().applySettings(draft)

  const saveLayout = () => {
    if (!selected || selected.isBuiltIn) return
    store().saveLayout({ ...selected, settings: draft })
    store().applyLayout(selected.id)
    onClose()
  }

  return (
    <Modal title="Edit layout" onClose={onClose} isWide hasCloseButton>
      <p className="field__hint layout-editor__intro">
        Drag a panel to a slot, or use the handle of a panel to move it with the
        keyboard.
      </p>
      <div className="layout-editor">
        <section
          className="layout-editor__list"
          aria-labelledby="layouts-title"
        >
          <h3 id="layouts-title" className="layout-editor__title">
            Layouts
          </h3>
          <div
            role="radiogroup"
            aria-labelledby="layouts-title"
            className="layout-cards"
          >
            {layouts.map((layout) => (
              <label
                key={layout.id}
                className={`layout-card ${layout.id === selectedId ? 'layout-card--selected' : ''}`}
              >
                <input
                  type="radio"
                  name="layout"
                  checked={layout.id === selectedId}
                  onChange={() => select(layout)}
                />
                <span className="layout-card__text">
                  <span className="layout-card__name">{layout.name}</span>
                  <span className="layout-card__detail">
                    {layout.isBuiltIn ? '' : 'Custom: '}
                    {describeSettings(layout.settings)}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="layout-editor__buttons">
            <button
              type="button"
              className="button button--small"
              onClick={() => add(unusedName(layouts, 'My layout'), draft)}
            >
              New layout
            </button>
            <button
              type="button"
              className="button button--small"
              disabled={!selected}
              onClick={() =>
                selected &&
                add(unusedName(layouts, `${selected.name} copy`), draft)
              }
            >
              Duplicate
            </button>
            <button
              type="button"
              className="button button--small"
              disabled={!selected || selected.isBuiltIn}
              onClick={() =>
                selected &&
                setPending({ kind: 'rename', name: selected.name, error: null })
              }
            >
              Rename
            </button>
            <button
              type="button"
              className="link-button link-button--danger"
              disabled={!selected || selected.isBuiltIn}
              onClick={() => setPending({ kind: 'delete' })}
            >
              Delete
            </button>
          </div>
          {pending?.kind === 'rename' && (
            <form className="layout-editor__pending" onSubmit={rename}>
              <label className="field">
                <span className="field__label">New name</span>
                <input
                  autoFocus
                  value={pending.name}
                  aria-invalid={pending.error !== null}
                  onChange={(event) =>
                    setPending({
                      kind: 'rename',
                      name: event.target.value,
                      error: null,
                    })
                  }
                />
              </label>
              {pending.error && (
                <p className="message message--error" role="alert">
                  {pending.error}
                </p>
              )}
              <div className="layout-editor__buttons">
                <button
                  type="submit"
                  className="button button--small button--primary"
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setPending(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {pending?.kind === 'delete' && selected && (
            <div className="layout-editor__pending" role="alert">
              <p>Delete the layout “{selected.name}”? You cannot undo this.</p>
              <div className="layout-editor__buttons">
                <button
                  type="button"
                  className="button button--small button--danger"
                  onClick={remove}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setPending(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <p className="field__hint">
            Standard and Simple cannot change. Duplicate one to start a custom
            layout.
          </p>
        </section>

        <div className="layout-editor__preview">
          <h3 className="layout-editor__title">
            {selected?.name ?? 'The window now'}{' '}
            <span className="field__hint">Preview of the window</span>
          </h3>
          <LayoutPreview
            settings={draft}
            isEditable={isEditable}
            onChange={setDraft}
          />
          <p className="field__hint">
            Slots: the left or right side for the sidebar. Below, beside, or a
            tab in the editor for the results. A column on the right or below
            the editor for the assistant.
          </p>
        </div>

        <fieldset className="layout-editor__settings" disabled={!isEditable}>
          <legend className="layout-editor__title">Panels</legend>
          {PANEL_OPTIONS.map((option) => (
            <label key={option.key} className="field field--check">
              <input
                type="checkbox"
                checked={
                  option.key === 'editor' ? true : draft.panels[option.key]
                }
                disabled={option.key === 'editor'}
                onChange={(event) =>
                  option.key !== 'editor' &&
                  change({
                    panels: {
                      ...draft.panels,
                      [option.key]: event.target.checked,
                    },
                  })
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
          <label className="field">
            <span className="field__label">Results position</span>
            <select
              value={draft.resultsPosition}
              onChange={(event) =>
                change({
                  resultsPosition: event.target.value as ResultsPosition,
                })
              }
            >
              {RESULTS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div
            className="field"
            role="radiogroup"
            aria-labelledby="sidebar-side-label"
          >
            <span id="sidebar-side-label" className="field__label">
              Sidebar side
            </span>
            <div className="form__checks">
              {(['left', 'right'] as const).map((side) => (
                <label key={side} className="field--check">
                  <input
                    type="radio"
                    name="sidebar-side"
                    checked={draft.sidebarSide === side}
                    onChange={() => change({ sidebarSide: side })}
                  />
                  <span>{side === 'left' ? 'Left' : 'Right'}</span>
                </label>
              ))}
            </div>
          </div>
          <SizeField
            id="layout-sidebar-width"
            label="Sidebar width (pixels)"
            value={draft.sidebarWidth}
            limits={SIDEBAR_WIDTH}
            disabled={!isEditable}
            onChange={(sidebarWidth) => change({ sidebarWidth })}
          />
          <SizeField
            id="layout-editor-size"
            label="Editor height (percent)"
            value={draft.editorSize}
            limits={EDITOR_SIZE}
            disabled={!isEditable}
            onChange={(editorSize) => change({ editorSize })}
          />
        </fieldset>
      </div>
      <div className="modal__actions">
        <button
          type="button"
          className="link-button"
          disabled={!isEditable}
          onClick={() => setDraft(STANDARD_SETTINGS)}
        >
          Reset to Standard
        </button>
        <span className="modal__spacer" />
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="button" onClick={apply}>
          Apply
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={!selected || selected.isBuiltIn}
          title={
            selected?.isBuiltIn
              ? 'A built-in layout cannot change. Duplicate it first.'
              : undefined
          }
          onClick={saveLayout}
        >
          Save layout
        </button>
      </div>
    </Modal>
  )
}
