import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Row } from '../../results/gridModel'
import { EmptyState, ViewError } from '../../view/ViewState'
import type { ViewProps } from '../viewTypes'
import { ChartCanvas, type ChartCanvasHandle } from './ChartCanvas'
import { noteText, prepareChart, type PreparedChart } from './chartData'
import { reducesPoints } from './chartOption'
import {
  incompleteReason,
  missingColumns,
  normalize,
  parseChartSettings,
  type ChartSettings,
} from './chartSettings'
import { ChartSettingsForm } from './ChartSettingsForm'
import { chartSentence } from './chartSentence'
import { chartSummary } from './chartSummary'
import { proposeChart } from './proposeChart'
import { SaveImageButton } from './SaveImageButton'

const numberFormat = new Intl.NumberFormat('en-US')

/** The settings of a result for which no rule gives a proposal. The user selects the columns. */
const NO_PROPOSAL: ChartSettings = { type: 'bar', y: [] }

function rowsText(value: number): string {
  return value === 1 ? '1 row' : `${numberFormat.format(value)} rows`
}

/**
 * Says which part of the result the chart shows. A chart must never look
 * complete when it is not. Returns `null` for a complete result.
 */
function partText(props: ViewProps, shown: number): string | null {
  const { hasMore, isComplete, totalRows } = props
  if (totalRows !== null && totalRows > shown) {
    return `Chart of the first ${numberFormat.format(shown)} of ${rowsText(totalRows)}.`
  }
  if (hasMore || !isComplete) {
    return `Chart of the first ${rowsText(shown)}. The result has more rows.`
  }
  return null
}

/**
 * Loads all rows of an open result, one page after the other. The fetch stops at
 * the row limit of the application. While it runs, the chart keeps the rows that
 * it had, because a new chart for each page is slow.
 */
function useLoadAll(props: ViewProps) {
  const { rows, hasMore, onNeedMore } = props
  /** The rows at the start of the load. `null` if the user did not start a load. */
  const [frozenRows, setFrozenRows] = useState<Row[] | null>(null)
  // A new run gives new rows. The load of the last result does not continue.
  const isSameResult =
    frozenRows !== null &&
    rows.length >= frozenRows.length &&
    rows[0] === frozenRows[0]
  const isLoadingAll = isSameResult && hasMore
  useEffect(() => {
    if (isLoadingAll) onNeedMore()
    // `rows` changes when a page arrives. The effect then asks for the next page.
  }, [isLoadingAll, rows, onNeedMore])
  return {
    isLoadingAll,
    shownRows: isLoadingAll ? frozenRows : rows,
    loadAll: () => setFrozenRows(rows),
    stop: () => setFrozenRows(null),
  }
}

/** The warnings about the cells of one column. They show at the control of that column. */
function columnWarnings(chart: PreparedChart): Record<string, string[]> {
  const warnings: Record<string, string[]> = {}
  for (const note of chart.notes) {
    if (!('column' in note)) continue
    warnings[note.column] = [...(warnings[note.column] ?? []), noteText(note)]
  }
  return warnings
}

function Notes(props: {
  part: ReactNode
  chart: PreparedChart
  width: number
  /** Sets the aggregate to None, after the chart set it to Sum. */
  onShowEachRow: () => void
}) {
  const { part, chart, width } = props
  // A note about one column is at the control of that column.
  const lines = chart.notes.filter((note) => !('column' in note)).map(noteText)
  if (chart.kind === 'cartesian' && reducesPoints(chart, width)) {
    lines.push(
      'A line has more points than the chart has pixels. The chart shows a reduced number of points for each line.',
    )
  }
  const isAuto = chart.kind === 'cartesian' && chart.isAutoAggregate
  if (part === null && lines.length === 0 && !isAuto) return null
  return (
    <ul className="chart__notes" aria-label="Notes about the chart">
      {part !== null && <li>{part}</li>}
      {isAuto && (
        <li>
          The values of the horizontal axis repeat. The chart shows the sum for
          each value.{' '}
          <button
            type="button"
            className="link-button"
            onClick={props.onShowEachRow}
          >
            Show each row
          </button>
        </li>
      )}
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

/**
 * The built-in chart view. It shows the loaded rows of a result as a line chart,
 * an area chart, a bar chart, a scatter plot, a histogram, or a single value.
 */
export function ChartView(props: ViewProps) {
  const { columns, rows, onSettings } = props
  const canvasRef = useRef<ChartCanvasHandle>(null)
  const [width, setWidth] = useState(0)
  const { isLoadingAll, shownRows, loadAll, stop } = useLoadAll(props)

  const parsed = useMemo(
    () =>
      props.settings === undefined ? null : parseChartSettings(props.settings),
    [props.settings],
  )
  // The number of rows decides only between a single value and a histogram.
  const isOneRow = rows.length === 1
  const proposal = useMemo(
    () => proposeChart(columns, isOneRow ? 1 : 2) ?? NO_PROPOSAL,
    [columns, isOneRow],
  )
  const settings =
    parsed !== null && 'settings' in parsed ? parsed.settings : proposal
  const missing = useMemo(
    () => missingColumns(settings, columns),
    [settings, columns],
  )
  const isUsable = missing.length === 0 && !(parsed && 'error' in parsed)
  const chart = useMemo<PreparedChart>(
    () =>
      isUsable
        ? prepareChart(settings, columns, shownRows)
        : { kind: 'empty', notes: [] },
    [isUsable, settings, columns, shownRows],
  )

  const { onShownSettings } = props
  const shownSettings = isUsable ? settings : undefined
  useEffect(() => {
    onShownSettings?.(shownSettings)
  }, [onShownSettings, shownSettings])

  if (parsed && 'error' in parsed) {
    return (
      <div className="chart">
        <ViewError
          title="The settings of the chart are not valid."
          detail={parsed.error}
        />
        <button
          type="button"
          className="button button--small chart__action"
          onClick={() => onSettings(proposal)}
        >
          Make a new chart
        </button>
      </div>
    )
  }
  if (missing.length > 0) {
    return (
      <div className="chart">
        <ViewError
          title={
            missing.length === 1
              ? `The result does not have the column ${missing[0]} of the chart settings.`
              : `The result does not have these columns of the chart settings: ${missing.join(', ')}.`
          }
          detail="The Grid view shows the result. The chart settings did not change."
        />
        <button
          type="button"
          className="button button--small chart__action"
          onClick={() => onSettings(proposal)}
        >
          Make a new chart
        </button>
      </div>
    )
  }

  const reason = incompleteReason(settings)
  const part = partText(props, shownRows.length)
  const partLine =
    part === null ? null : (
      <>
        {isLoadingAll
          ? `Loading the rows. ${rowsText(rows.length)} loaded. `
          : `${part} `}
        {props.hasMore && (
          <button
            type="button"
            className="link-button"
            onClick={isLoadingAll ? stop : loadAll}
          >
            {isLoadingAll ? 'Stop' : 'Load all rows'}
          </button>
        )}
      </>
    )
  const summary = chartSummary(chart)
  const sentence = chartSentence(chart, shownRows.length)
  const warnings = columnWarnings(chart)
  // The form shows what "Automatic" is now. A view without a chart does not know it.
  const autoAggregate =
    chart.kind === 'cartesian' && settings.aggregate === undefined
      ? chart.aggregate
      : undefined

  return (
    <div className="chart">
      <div className="chart__bar">
        <ChartSettingsForm
          settings={settings}
          columns={columns}
          onChange={onSettings}
          autoAggregate={autoAggregate}
          warnings={warnings}
          onReset={
            props.settings === undefined
              ? undefined
              : () => onSettings(undefined)
          }
        />
        <SaveImageButton
          canvas={canvasRef}
          isAvailable={reason === null && chart.kind === 'cartesian'}
        />
      </div>
      {sentence !== null && reason === null && (
        <p className="chart__sentence">
          <strong>{sentence.what}</strong> <span>{sentence.size}</span>
        </p>
      )}
      <Notes
        part={partLine}
        chart={chart}
        width={width}
        onShowEachRow={() =>
          onSettings(normalize({ ...settings, aggregate: 'none' }))
        }
      />
      {reason !== null && <EmptyState text={reason} />}
      {reason === null && chart.kind === 'empty' && (
        <EmptyState text="The chart has no data to show." />
      )}
      {reason === null && chart.kind === 'value' && (
        <figure className="chart__value">
          <output>{chart.text}</output>
          <figcaption>{chart.label}</figcaption>
        </figure>
      )}
      {reason === null && chart.kind === 'cartesian' && (
        <ChartCanvas
          ref={canvasRef}
          chart={chart}
          settings={settings}
          summary={summary}
          onWidth={setWidth}
        />
      )}
    </div>
  )
}
