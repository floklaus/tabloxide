import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { Column } from '../../results/gridModel'
import { KIND_LABELS } from './columnKinds'
import { KindIcon, RowsIcon, WarningIcon } from './KindIcon'

/** The value of the entry that is not a column, for example "None". */
export const NO_COLUMN = ''

type Entry = {
  value: string
  label: string
  icon: ReactNode
  /** The type name of the database, or a word for an entry that is not a column. */
  detail: string
  /** The words that a screen reader gets after the name. */
  spoken: string
}

type Props = {
  label: string
  columns: Column[]
  /** The names of the selected columns. `NO_COLUMN` selects the special entry. */
  selected: string[]
  /** `true`: the user can select more than one column. */
  isMultiple?: boolean
  /** An entry before the columns that is not a column, for example "Number of rows". */
  special?: { label: string; detail: string; isRows?: boolean }
  /** The text of the button when nothing is selected. */
  placeholder: string
  /** The warnings about the selected columns. They show below the control. */
  warnings?: string[]
  onChange: (selected: string[]) => void
}

/** One entry for each column name. A result can have the same name two times. */
function columnEntries(columns: Column[]): Entry[] {
  const seen = new Set<string>()
  return columns.flatMap((column) => {
    if (seen.has(column.name)) return []
    seen.add(column.name)
    return [
      {
        value: column.name,
        label: column.name,
        icon: <KindIcon kind={column.kind} />,
        detail: column.type_name ?? KIND_LABELS[column.kind],
        spoken: KIND_LABELS[column.kind],
      },
    ]
  })
}

/**
 * A list of the columns of a result that opens below its button. Each column
 * shows its kind as an icon and the type name of the database. The list has
 * radio buttons for one column and check boxes for more than one.
 */
export function ColumnPicker(props: Props) {
  const { label, columns, selected, isMultiple = false, special } = props
  const { warnings = [], onChange } = props
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const id = useId()
  const entries: Entry[] = [
    ...(special
      ? [
          {
            value: NO_COLUMN,
            label: special.label,
            icon: special.isRows ? <RowsIcon /> : null,
            detail: special.detail,
            spoken: special.detail,
          },
        ]
      : []),
    ...columnEntries(columns),
  ]
  const shown = entries.filter((entry) => selected.includes(entry.value))

  const close = () => {
    if (detailsRef.current) detailsRef.current.open = false
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key !== 'Escape' || !detailsRef.current?.open) return
    event.stopPropagation()
    close()
    detailsRef.current.querySelector('summary')?.focus()
  }
  const toggle = (value: string) => {
    if (!isMultiple) {
      onChange([value])
      close()
      detailsRef.current?.querySelector('summary')?.focus()
      return
    }
    // The special entry and the columns exclude each other.
    if (value === NO_COLUMN) return onChange([NO_COLUMN])
    const names = selected.filter((item) => item !== NO_COLUMN)
    const next = names.includes(value)
      ? names.filter((item) => item !== value)
      : // The sequence of the columns of the result is the sequence of the series.
        entries
          .map((entry) => entry.value)
          .filter((item) => item === value || names.includes(item))
    onChange(next)
  }

  return (
    <div className="chart__field">
      <span id={id}>{label}</span>
      <details
        ref={detailsRef}
        className="chart__picker"
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) close()
        }}
      >
        <summary
          aria-labelledby={`${id} ${id}-value`}
          aria-describedby={warnings.length > 0 ? `${id}-warning` : undefined}
        >
          {shown.length === 1 && shown[0].icon}
          <span id={`${id}-value`} className="chart__picker-value">
            {shown.length === 0
              ? props.placeholder
              : shown.map((entry) => entry.label).join(', ')}
          </span>
          {warnings.length > 0 && <WarningIcon />}
        </summary>
        <div
          className="chart__picker-list"
          role={isMultiple ? 'group' : 'radiogroup'}
          aria-labelledby={id}
        >
          {entries.map((entry) => (
            <label key={entry.value}>
              <input
                type={isMultiple ? 'checkbox' : 'radio'}
                name={isMultiple ? undefined : id}
                checked={selected.includes(entry.value)}
                onChange={() => toggle(entry.value)}
                // A click on the selected radio button also closes the list.
                onClick={() => {
                  if (!isMultiple && selected.includes(entry.value)) close()
                }}
              />
              {entry.icon}
              <span className="chart__picker-name">{entry.label}</span>
              <span className="visually-hidden">, {entry.spoken}</span>
              <span className="chart__picker-type" aria-hidden="true">
                {entry.detail}
              </span>
            </label>
          ))}
        </div>
      </details>
      {warnings.length > 0 && (
        <div id={`${id}-warning`} className="chart__warnings">
          {warnings.map((warning) => (
            <p key={warning} className="chart__warning">
              <WarningIcon />
              {warning}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
