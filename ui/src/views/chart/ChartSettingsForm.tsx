import { useId, useRef, type KeyboardEvent } from 'react'
import type { Column } from '../../results/gridModel'
import {
  AGGREGATE_LABELS,
  AGGREGATES,
  CHART_ROLES,
  CHART_TYPE_LABELS,
  CHART_TYPES,
  normalize,
  withType,
  type Aggregate,
  type ChartSettings,
  type ChartType,
} from './chartSettings'

type Props = {
  settings: ChartSettings
  columns: Column[]
  onChange: (settings: ChartSettings) => void
}

const NONE = ''

/** The names of the columns. A result can have the same name two times. */
function columnNames(columns: Column[]): string[] {
  return [...new Set(columns.map((column) => column.name))]
}

function ColumnSelect(props: {
  label: string
  value: string | undefined
  names: string[]
  /** The text of the choice without a column. */
  none: string
  onChange: (name: string | undefined) => void
}) {
  const { label, value, names, none, onChange } = props
  return (
    <label className="chart__field">
      <span>{label}</span>
      <select
        value={value ?? NONE}
        onChange={(event) =>
          onChange(event.target.value === NONE ? undefined : event.target.value)
        }
      >
        <option value={NONE}>{none}</option>
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
}

/** A list with a check box for each column. It opens below its button. */
function ColumnsPicker(props: {
  label: string
  selected: string[]
  names: string[]
  onChange: (names: string[]) => void
}) {
  const { label, selected, names, onChange } = props
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const id = useId()
  const close = () => {
    if (detailsRef.current) detailsRef.current.open = false
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key !== 'Escape' || !detailsRef.current?.open) return
    event.stopPropagation()
    close()
    detailsRef.current.querySelector('summary')?.focus()
  }
  const toggle = (name: string) =>
    onChange(
      selected.includes(name)
        ? selected.filter((item) => item !== name)
        : // The sequence of the columns of the result is the sequence of the series.
          names.filter((item) => item === name || selected.includes(item)),
    )
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
        <summary aria-labelledby={id} aria-describedby={`${id}-value`}>
          <span id={`${id}-value`}>
            {selected.length === 0 ? 'Select columns' : selected.join(', ')}
          </span>
        </summary>
        <div className="chart__picker-list" role="group" aria-labelledby={id}>
          {names.map((name) => (
            <label key={name}>
              <input
                type="checkbox"
                checked={selected.includes(name)}
                onChange={() => toggle(name)}
              />
              {name}
            </label>
          ))}
        </div>
      </details>
    </div>
  )
}

/** The controls for the chart type and the role of each column. */
export function ChartSettingsForm({ settings, columns, onChange }: Props) {
  const roles = CHART_ROLES[settings.type]
  const names = columnNames(columns)
  const change = (part: Partial<ChartSettings>) =>
    onChange(normalize({ ...settings, ...part }))
  const isHistogram = settings.type === 'histogram'

  return (
    <div className="chart__tools" role="group" aria-label="Chart settings">
      <label className="chart__field">
        <span>Chart type</span>
        <select
          value={settings.type}
          onChange={(event) =>
            onChange(
              withType(settings, event.target.value as ChartType, columns),
            )
          }
        >
          {CHART_TYPES.map((type) => (
            <option key={type} value={type}>
              {CHART_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      {roles.x && (
        <ColumnSelect
          label={isHistogram ? 'Column' : 'Horizontal axis'}
          value={settings.x}
          names={names}
          none="Select a column"
          onChange={(x) => change({ x })}
        />
      )}
      {roles.y === 'many' && (
        <ColumnsPicker
          label="Vertical axis"
          selected={settings.y}
          names={names}
          onChange={(y) => change({ y })}
        />
      )}
      {roles.y === 'one' && (
        <ColumnSelect
          label="Value"
          value={settings.y[0]}
          names={names}
          none="Select a column"
          onChange={(name) => change({ y: name === undefined ? [] : [name] })}
        />
      )}
      {roles.series && (
        <ColumnSelect
          label="Series"
          value={settings.series}
          names={names}
          none="None"
          onChange={(series) => change({ series })}
        />
      )}
      {roles.aggregate && (
        <label className="chart__field">
          <span>Aggregate</span>
          <select
            value={settings.aggregate ?? NONE}
            onChange={(event) =>
              change({
                aggregate:
                  event.target.value === NONE
                    ? undefined
                    : (event.target.value as Aggregate),
              })
            }
          >
            <option value={NONE}>None</option>
            {AGGREGATES.map((aggregate) => (
              <option key={aggregate} value={aggregate}>
                {AGGREGATE_LABELS[aggregate]}
              </option>
            ))}
          </select>
        </label>
      )}
      {roles.stacked && (
        <label className="chart__check">
          <input
            type="checkbox"
            checked={settings.stacked ?? false}
            onChange={(event) => change({ stacked: event.target.checked })}
          />
          Stacked
        </label>
      )}
      {roles.scale && (
        <label className="chart__check">
          <input
            type="checkbox"
            checked={settings.scale === 'log'}
            onChange={(event) =>
              change({ scale: event.target.checked ? 'log' : 'linear' })
            }
          />
          Logarithmic scale
        </label>
      )}
    </div>
  )
}
