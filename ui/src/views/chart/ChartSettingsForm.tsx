import type { Column } from '../../results/gridModel'
import {
  AGGREGATE_LABELS,
  AGGREGATES,
  axisControls,
  CHART_ROLES,
  CHART_TYPE_LABELS,
  CHART_TYPES,
  normalize,
  SORT_LABELS,
  SORTS,
  TIME_UNIT_LABELS,
  TIME_UNITS,
  withType,
  withX,
  type Aggregate,
  type AggregateSetting,
  type ChartSettings,
  type ChartType,
  type Sort,
  type TimeUnit,
} from './chartSettings'
import { ColumnPicker, NO_COLUMN } from './ColumnPicker'

type Props = {
  settings: ChartSettings
  columns: Column[]
  onChange: (settings: ChartSettings) => void
  /**
   * The aggregate that the chart uses while the settings have none. `null`:
   * each row is one mark. `undefined`: not known, because there is no chart.
   */
  autoAggregate?: Aggregate | null
  /** The warnings about the cells of a column, by the name of the column. */
  warnings?: Record<string, string[]>
  /** Removes the settings, thus the proposed chart shows again. */
  onReset?: () => void
}

const NONE = ''
const ROWS = { label: 'Number of rows', detail: 'no column', isRows: true }
const NO_SERIES = { label: 'None', detail: 'one series' }

function selectedColumn(names: string[]): string | undefined {
  return names[0] === NO_COLUMN ? undefined : names[0]
}

/** The label of the choice that lets the chart decide the aggregate. */
function automaticLabel(auto: Aggregate | null | undefined): string {
  if (auto === undefined) return 'Automatic'
  return `Automatic (${auto === null ? 'None' : AGGREGATE_LABELS[auto]})`
}

function AggregateSelect(
  props: Pick<Props, 'settings' | 'autoAggregate'> & {
    onChange: (aggregate: AggregateSetting | undefined) => void
  },
) {
  const { settings, autoAggregate, onChange } = props
  // A single value has no automatic aggregate: without one, it shows the first row.
  const isAutomatic = settings.type !== 'value'
  return (
    <label className="chart__field">
      <span>Aggregate</span>
      <select
        value={settings.aggregate ?? NONE}
        onChange={(event) =>
          onChange(
            event.target.value === NONE
              ? undefined
              : (event.target.value as AggregateSetting),
          )
        }
      >
        <option value={NONE}>
          {isAutomatic ? automaticLabel(autoAggregate) : 'None'}
        </option>
        {isAutomatic && <option value="none">None</option>}
        {AGGREGATES.map((aggregate) => (
          <option key={aggregate} value={aggregate}>
            {AGGREGATE_LABELS[aggregate]}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The controls for the chart type and the role of each column. */
export function ChartSettingsForm(props: Props) {
  const { settings, columns, onChange, warnings = {}, onReset } = props
  const roles = CHART_ROLES[settings.type]
  const controls = axisControls(settings, columns)
  const change = (part: Partial<ChartSettings>) =>
    onChange(normalize({ ...settings, ...part }))
  const isHistogram = settings.type === 'histogram'
  const rows = roles.countRows ? ROWS : undefined
  const ySelected = settings.countRows ? [NO_COLUMN] : settings.y
  const changeY = (names: string[]) =>
    names.includes(NO_COLUMN)
      ? change({ countRows: true, y: [] })
      : change({ countRows: false, y: names })

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
        <ColumnPicker
          label={isHistogram ? 'Column' : 'Horizontal axis'}
          columns={columns}
          selected={settings.x === undefined ? [] : [settings.x]}
          placeholder="Select a column"
          warnings={settings.x === undefined ? [] : warnings[settings.x]}
          onChange={(names) => onChange(withX(settings, names[0], columns))}
        />
      )}
      {controls.timeUnit && (
        <label className="chart__field">
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
        <label className="chart__field">
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
      {roles.y !== 'none' && (
        <ColumnPicker
          label={roles.y === 'many' ? 'Vertical axis' : 'Value'}
          columns={columns}
          selected={ySelected}
          isMultiple={roles.y === 'many'}
          special={rows}
          placeholder={
            roles.y === 'many' ? 'Select columns' : 'Select a column'
          }
          warnings={settings.y.flatMap((name) => warnings[name] ?? [])}
          onChange={changeY}
        />
      )}
      {roles.aggregate && !settings.countRows && (
        <AggregateSelect
          settings={settings}
          autoAggregate={props.autoAggregate}
          onChange={(aggregate) => change({ aggregate })}
        />
      )}
      {roles.series && (
        <ColumnPicker
          label="Series"
          columns={columns}
          selected={[settings.series ?? NO_COLUMN]}
          special={NO_SERIES}
          placeholder="None"
          onChange={(names) => change({ series: selectedColumn(names) })}
        />
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
      {onReset && (
        <button
          type="button"
          className="link-button chart__reset"
          title="Removes your settings and shows the chart that Tabloxide proposes."
          onClick={onReset}
        >
          Reset to the proposed chart
        </button>
      )}
    </div>
  )
}
