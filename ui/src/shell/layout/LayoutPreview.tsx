import { useState, type DragEvent, type ReactNode } from 'react'
import { Icon } from '../icons'
import { MenuButton } from '../menu/MenuButton'
import {
  moveToSlot,
  SLOTS,
  slotOf,
  type LayoutSettings,
  type MovablePanel,
} from './layoutModel'

/** The width of the window that the preview shows, for the size of the sidebar. */
const WINDOW_WIDTH = 1400

const PANEL_NAMES: Record<MovablePanel, string> = {
  sidebar: 'Sidebar',
  results: 'Results',
  assistant: 'Assistant',
}

const PANEL_TEXT: Record<MovablePanel, string> = {
  sidebar: 'Files, Connections, Schema, Git, History',
  results: 'Results, History, Table, Plan, Diff',
  assistant: 'Requests to the AI assistant',
}

type Props = {
  settings: LayoutSettings
  /** `false` for a built-in layout. The preview then shows the layout only. */
  isEditable: boolean
  onChange: (settings: LayoutSettings) => void
}

type BoxProps = {
  panel: MovablePanel
  settings: LayoutSettings
  isEditable: boolean
  onMove: (panel: MovablePanel, slot: string) => void
  onDragStart: (panel: MovablePanel) => void
  onDragEnd: () => void
  style?: React.CSSProperties
}

function PanelBox({
  panel,
  settings,
  isEditable,
  onMove,
  onDragStart,
  onDragEnd,
  style,
}: BoxProps) {
  const name = PANEL_NAMES[panel]
  const current = slotOf(settings, panel)
  return (
    <div
      className="preview__panel"
      style={style}
      draggable={isEditable}
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.setData('text/plain', panel)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart(panel)
      }}
      onDragEnd={onDragEnd}
    >
      <div className="preview__head">
        {isEditable ? (
          <MenuButton
            label={`Move the ${name} panel`}
            menuLabel={`Slots of the ${name} panel`}
            className="preview__handle"
            items={() =>
              SLOTS[panel].map((slot) => ({
                kind: 'radio',
                label: slot.label,
                checked: slot.value === current,
                run: () => onMove(panel, slot.value),
              }))
            }
          >
            <Icon name="grip" size={14} />
          </MenuButton>
        ) : (
          <span className="preview__handle-space" />
        )}
        <span className="preview__name">{name}</span>
      </div>
      <span className="preview__text">{PANEL_TEXT[panel]}</span>
    </div>
  )
}

/**
 * A small picture of the window. The user drags a panel onto a slot, or moves it
 * with the menu of its handle.
 */
export function LayoutPreview({ settings, isEditable, onChange }: Props) {
  const [dragging, setDragging] = useState<MovablePanel | null>(null)
  const { panels } = settings
  const move = (panel: MovablePanel, slot: string) =>
    onChange(moveToSlot(settings, panel, slot))
  const box = (panel: MovablePanel, style?: React.CSSProperties) => (
    <PanelBox
      panel={panel}
      settings={settings}
      isEditable={isEditable}
      onMove={move}
      onDragStart={setDragging}
      onDragEnd={() => setDragging(null)}
      style={style}
    />
  )
  const resultsBelow = panels.results && settings.resultsPosition === 'below'
  const resultsBeside = panels.results && settings.resultsPosition === 'beside'
  const resultsTab = panels.results && settings.resultsPosition === 'tab'
  const assistantBelow =
    panels.assistant && settings.assistantPlacement === 'below-editor'
  const assistantRight =
    panels.assistant && settings.assistantPlacement === 'right'
  const sidebar = (side: 'left' | 'right'): ReactNode =>
    panels.sidebar && settings.sidebarSide === side
      ? box('sidebar', {
          flex: `0 0 ${(settings.sidebarWidth / WINDOW_WIDTH) * 100}%`,
        })
      : null

  return (
    <section className="preview" aria-label="Preview of the window">
      <div className="preview__bar">Title bar, menu bar, and widgets</div>
      <div className="preview__body">
        {sidebar('left')}
        <div className="preview__column">
          <div
            className="preview__panel preview__panel--editor"
            style={{
              flex:
                resultsBelow || assistantBelow
                  ? `0 0 ${settings.editorSize}%`
                  : '1',
            }}
          >
            <div className="preview__head">
              <span className="preview__handle-space" />
              <span className="preview__name">Editor</span>
            </div>
            <span className="preview__text">
              {resultsTab
                ? 'Always shown. The results are a tab here.'
                : 'Always shown'}
            </span>
          </div>
          {resultsBelow && box('results', { flex: 1 })}
          {assistantBelow && box('assistant', { flex: 1 })}
        </div>
        {resultsBeside && box('results', { flex: '0 0 32%' })}
        {assistantRight && box('assistant', { flex: '0 0 24%' })}
        {sidebar('right')}
        {dragging && (
          <div className="preview__slots" aria-hidden="true">
            <p className="preview__slots-title">
              Drop the {PANEL_NAMES[dragging]} panel on a slot
            </p>
            {SLOTS[dragging].map((slot) => (
              <div
                key={slot.value}
                className="preview__slot"
                data-slot={slot.value}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  move(dragging, slot.value)
                  setDragging(null)
                }}
              >
                {slot.label}
              </div>
            ))}
          </div>
        )}
      </div>
      <div
        className={`preview__bar ${panels.statusBar ? '' : 'preview__bar--hidden'}`}
      >
        {panels.statusBar ? 'Status bar' : 'Status bar (hidden in this layout)'}
      </div>
    </section>
  )
}
