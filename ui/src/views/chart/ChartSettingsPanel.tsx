import { useId, useState, type ReactNode } from 'react'
import type { Column } from '../../results/gridModel'
import {
  AGGREGATE_LABELS,
  AGGREGATES,
  aggregateOf,
  axisControls,
  CHART_ROLES,
  CHART_TYPE_LABELS,
  CHART_TYPES,
  normalize,
  SORT_LABELS,
  SORTS,
  TIME_UNIT_LABELS,
  TIME_UNITS,
  typeProblem,
  withAggregate,
  withType,
  withX,
  type Aggregate,
  type AggregateSetting,
  type ChartSettings,
  type ChartType,
  type Sort,
  type TimeUnit,
} from './chartSettings'
import { ChartTypeIcon } from './ChartTypeIcon'
import { ColumnPicker, NO_COLUMN } from './ColumnPicker'
import { KindIcon, RowsIcon, WarningIcon } from './KindIcon'

type Props = {
  settings: ChartSettings
  columns: Column[]
  onChange: (settings: ChartSettings) => void
  /**
   * The aggregate that a column without a setting gets now. `null`: each row
   * is one mark. `undefined`: not known, because there is no chart.
   */
  automatic?: Aggregate | null
  /** The warnings about the cells of a column, by the name of the column. */
  warnings?: Record<string, string[]>
  /** Removes the settings, thus the first suggested chart shows again. */
  onReset?: () => void
  onClose: () => void
}

const NONE = ''
const ROWS = { label: 'Number of rows', detail: 'no column', isRows: true }
const NO_SERIES = { label: 'None', detail: 'one series' }

function Section(props: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <div className="chart__section" role="group" aria-labelledby={id}>
      <span id={id} className="chart__label">
        {props.title}
      </span>
      {props.children}
    </div>
  )
}

/** A row of buttons with one picture for each chart type. */
function TypePicker({ settings, columns, onChange }: Props) {
  /** The type that has the focus or the pointer. The line below the buttons shows its name. */
  const [hint, setHint] = useState<ChartType | null>(null)
  const shown = hint ?? settings.type
  const problem = typeProblem(shown, columns)
  return (
    <Section title="Chart type">
      <div className="chart__types">
        {CHART_TYPES.map((type) => {
          const cause = typeProblem(type, columns)
          const label = CHART_TYPE_LABELS[type]
          return (
            <button
              key={type}
              type="button"
              className="chart__type"
              aria-label={cause === null ? label : `${label}. ${cause}`}
              aria-pressed={type === settings.type}
              // A type that cannot work keeps the focus, thus the user can read the cause.
              aria-disabled={cause !== null}
              onFocus={() => setHint(type)}
              onBlur={() => setHint(null)}
              onMouseEnter={() => setHint(type)}
              onMouseLeave={() => setHint(null)}
              onClick={() => {
                if (cause === null) onChange(withType(settings, type, columns))
              }}
            >
              <ChartTypeIcon type={type} />
            </button>
          )
        })}
      </div>
      <p className="chart__type-name" aria-hidden="true">
        {CHART_TYPE_LABELS[shown]}
        {problem !== null && `. ${problem}`}
      </p>
    </Section>
  )
}

function AggregateSelect(props: {
  column: string
  value: AggregateSetting | undefined
  /** The label of the choice without an aggregate setting. */
  defaultLabel: string
  /** `true` if "None" is a choice in addition to the default. */
  hasNone: boolean
  onChange: (aggregate: AggregateSetting | undefined) => void
}) {
  return (
    <select
      className="chart__aggregate"
      aria-label={`Aggregate of ${props.column}`}
      value={props.value ?? NONE}
      onChange={(event) =>
        props.onChange(
          event.target.value === NONE
            ? undefined
            : (event.target.value as AggregateSetting),
        )
      }
    >
      <option value={NONE}>{props.defaultLabel}</option>
      {props.hasNone && <option value="none">None</option>}
      {AGGREGATES.map((aggregate) => (
        <option key={aggregate} value={aggregate}>
          {AGGREGATE_LABELS[aggregate]}
        </option>
      ))}
    </select>
  )
}

function Warnings({ texts }: { texts: string[] | undefined }) {
  if (!texts || texts.length === 0) return null
  return (
    <div className="chart__warnings">
      {texts.map((text) => (
        <p key={text} className="chart__warning">
          <WarningIcon />
          {text}
        </p>
      ))}
    </div>
  )
}

/** The label of the choice that lets the chart decide the aggregate. */
function automaticLabel(automatic: Aggregate | null | undefined): string {
  if (automatic === undefined) return 'Automatic'
  return `Automatic (${automatic === null ? 'None' : AGGREGATE_LABELS[automatic]})`
}

/** The columns of the vertical axis: one row for each column, with its aggregate. */
function VerticalAxis(props: Props) {
  const { settings, columns, onChange, warnings = {} } = props
  const change = (part: Partial<ChartSettings>) =>
    onChange(normalize({ ...settings, ...part }))
  const free = columns.filter((column) => !settings.y.includes(column.name))
  const add = ([name]: string[]) =>
    name === NO_COLUMN
      ? change({ countRows: true, y: [] })
      : change({ countRows: false, y: [...settings.y, name] })

  return (
    <Section title="Vertical axis">
      {settings.countRows && (
        <div className="chart__row">
          <RowsIcon />
          <span className="chart__row-name">Number of rows</span>
          <button
            type="button"
            className="chart__remove"
            aria-label="Remove the number of rows from the vertical axis"
            title="Remove"
            onClick={() => change({ countRows: false })}
          >
            ×
          </button>
        </div>
      )}
      {settings.y.map((name) => (
        <div key={name} className="chart__row-group">
          <div className="chart__row">
            <KindIcon
              kind={columns.find((c) => c.name === name)?.kind ?? 'other'}
            />
            <span className="chart__row-name">{name}</span>
            <AggregateSelect
              column={name}
              value={aggregateOf(settings, name)}
              defaultLabel={automaticLabel(props.automatic)}
              hasNone
              onChange={(aggregate) =>
                onChange(withAggregate(settings, name, aggregate))
              }
            />
            <button
              type="button"
              className="chart__remove"
              aria-label={`Remove ${name} from the vertical axis`}
              title="Remove"
              onClick={() =>
                change({ y: settings.y.filter((item) => item !== name) })
              }
            >
              ×
            </button>
          </div>
          <Warnings texts={warnings[name]} />
        </div>
      ))}
      <ColumnPicker
        label="Add a column to the vertical axis"
        isLabelHidden
        columns={free}
        selected={[]}
        special={settings.countRows ? undefined : ROWS}
        placeholder="Add a column"
        onChange={add}
      />
    </Section>
  )
}

/** The column of a single value, with its aggregate. */
function SingleValue(props: Props) {
  const { settings, columns, onChange, warnings = {} } = props
  const [name] = settings.y
  const change = (part: Partial<ChartSettings>) =>
    onChange(normalize({ ...settings, ...part }))
  return (
    <>
      <ColumnPicker
        label="Value"
        columns={columns}
        selected={settings.countRows ? [NO_COLUMN] : settings.y}
        special={ROWS}
        placeholder="Select a column"
        warnings={name === undefined ? [] : warnings[name]}
        onChange={([column]) =>
          column === NO_COLUMN
            ? change({ countRows: true, y: [] })
            : change({ countRows: false, y: [column] })
        }
      />
      {name !== undefined && (
        <label className="chart__inline">
          <span>Aggregate</span>
          {/* A single value has no automatic aggregate: without one, it shows the first row. */}
          <AggregateSelect
            column={name}
            value={aggregateOf(settings, name)}
            defaultLabel="None"
            hasNone={false}
            onChange={(aggregate) =>
              onChange(withAggregate(settings, name, aggregate))
            }
          />
        </label>
      )}
    </>
  )
}

/** The column of the horizontal axis, with the time unit of a date or the sort of categories. */
function HorizontalAxis(props: Props) {
  const { settings, columns, onChange, warnings = {} } = props
  const controls = axisControls(settings, columns)
  const change = (part: Partial<ChartSettings>) =>
    onChange(normalize({ ...settings, ...part }))
  return (
    <>
      <ColumnPicker
        label={settings.type === 'histogram' ? 'Column' : 'Horizontal axis'}
        columns={columns}
        selected={settings.x === undefined ? [] : [settings.x]}
        placeholder="Select a column"
        warnings={settings.x === undefined ? [] : warnings[settings.x]}
        onChange={(names) => onChange(withX(settings, names[0], columns))}
      />
      {controls.timeUnit && (
        <label className="chart__inline">
          <span>Group by</span>
          <select
            value={settings.timeUnit ?? NONE}
            onChange={(event) =>
              change({
                timeUnit:
                  event.target.value === NONE
                    ? undefined
                    : (event.target.value as TimeUnit),
              })
            }
          >
            <option value={NONE}>None</option>
            {TIME_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {TIME_UNIT_LABELS[unit]}
              </option>
            ))}
          </select>
        </label>
      )}
      {controls.sort && (
        <label className="chart__inline">
          <span>Sort</span>
          <select
            value={settings.sort ?? NONE}
            onChange={(event) =>
              change({
                sort:
                  event.target.value === NONE
                    ? undefined
                    : (event.target.value as Sort),
              })
            }
          >
            <option value={NONE}>As in the result</option>
            {SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  )
}

function Display({ settings, onChange }: Props) {
  const roles = CHART_ROLES[settings.type]
  if (!roles.stacked && !roles.scale) return null
  const change = (part: Partial<ChartSettings>) =>
    onChange(normalize({ ...settings, ...part }))
  return (
    <Section title="Display">
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
    </Section>
  )
}

/**
 * The settings of a chart: the chart type, the role of each column, and the
 * display. The panel is at the right of the chart. In a narrow results pane, it
 * is above the chart.
 */
export function ChartSettingsPanel(props: Props) {
  const { settings, columns, onChange } = props
  const roles = CHART_ROLES[settings.type]
  const titleId = useId()
  return (
    <aside className="chart__panel" aria-labelledby={titleId}>
      <div className="chart__panel-head">
        <h3 id={titleId}>Chart settings</h3>
        <button
          type="button"
          className="chart__remove"
          aria-label="Close the chart settings"
          title="Close the chart settings"
          onClick={props.onClose}
        >
          ×
        </button>
      </div>
      <TypePicker {...props} />
      {roles.x && <HorizontalAxis {...props} />}
      {roles.y === 'many' && <VerticalAxis {...props} />}
      {roles.y === 'one' && <SingleValue {...props} />}
      {roles.series && (
        <ColumnPicker
          label="Series"
          columns={columns}
          selected={[settings.series ?? NO_COLUMN]}
          special={NO_SERIES}
          placeholder="None"
          onChange={([name]) =>
            onChange(
              normalize({
                ...settings,
                series: name === NO_COLUMN ? undefined : name,
              }),
            )
          }
        />
      )}
      <Display {...props} />
      {props.onReset && (
        <button
          type="button"
          className="link-button chart__reset"
          title="Removes your settings and shows the first chart that Tabloxide suggests."
          onClick={props.onReset}
        >
          Reset to the first suggested chart
        </button>
      )}
    </aside>
  )
}
