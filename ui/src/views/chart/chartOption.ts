import type { EChartsCoreOption } from 'echarts/core'
import type { CartesianChart, ChartSeries } from './chartData'
import type { ChartSettings } from './chartSettings'
import type { ChartTheme } from './chartTheme'
import { formatNumber } from './chartValues'

/** The marks of the series. Colour is never the only sign of a series. */
const SYMBOLS = [
  'circle',
  'rect',
  'triangle',
  'diamond',
  'roundRect',
  'pin',
  'arrow',
  'emptyCircle',
]
/** The line styles of the series in the high contrast theme. */
const DASHES: (string | number[])[] = [
  'solid',
  'dashed',
  'dotted',
  [12, 4],
  [2, 6],
  [12, 4, 2, 4],
  [6, 2, 2, 2, 2, 2],
  [16, 6],
]

const LINE_WIDTH = 2
const BAR_MAX_WIDTH = 24
const BAR_RADIUS = 4
const SYMBOL_SIZE = 8
const SMALL_SYMBOL_SIZE = 4
/** A line shows a mark on each point only up to this number of points. */
const MAX_LINE_SYMBOLS = 30
/** ECharts draws more marks than this in its fast mode. Section 14 of the design gives the reason. */
const LARGE_SCATTER = 2000
const LARGE_BAR = 1000
/** A chart with more marks than this has a zoom control. */
const ZOOM_FROM = 50
/** A chart with more marks than this draws without an animation. */
const MAX_ANIMATED_MARKS = 2000
const AREA_OPACITY = 0.12
const STACKED_AREA_OPACITY = 0.35
const SCATTER_OPACITY = 0.8
const LEGEND_HEIGHT = 32
const ZOOM_HEIGHT = 44
const X_NAME_GAP = 28

export type OptionContext = {
  theme: ChartTheme
  /** `false` if the user asked the system for less motion. */
  canAnimate: boolean
}

function isContinuous(chart: CartesianChart): boolean {
  return chart.xAxis !== 'category'
}

function longestSeries(chart: CartesianChart): number {
  return Math.max(
    ...chart.series.map((series) =>
      isContinuous(chart) ? series.points.length : chart.categories.length,
    ),
  )
}

/**
 * Stacked series need a value at each position. ECharts stacks by the index of a
 * point, not by its position. This gives each series all positions, with 0 where
 * a series has no row.
 */
function alignForStack(series: ChartSeries[]): ChartSeries[] {
  const positions = [
    ...new Set(series.flatMap((item) => item.points.map(([x]) => x))),
  ].sort((a, b) => a - b)
  return series.map((item) => {
    const values = new Map(item.points)
    return {
      ...item,
      points: positions.map((x) => [x, values.get(x) ?? 0] as [number, number]),
    }
  })
}

function seriesOption(
  chart: CartesianChart,
  settings: ChartSettings,
  series: ChartSeries,
  index: number,
  context: OptionContext,
) {
  const data = isContinuous(chart) ? series.points : series.values
  const stack = settings.stacked ? 'total' : undefined
  const base = { name: series.name, data, emphasis: { focus: 'series' } }
  const symbol = SYMBOLS[index % SYMBOLS.length]

  if (chart.type === 'scatter') {
    return {
      ...base,
      type: 'scatter',
      symbol,
      symbolSize:
        chart.pointCount > LARGE_SCATTER ? SMALL_SYMBOL_SIZE : SYMBOL_SIZE,
      // Without the large mode, 100 000 points need more than 20 seconds.
      large: true,
      largeThreshold: LARGE_SCATTER,
      itemStyle: { opacity: SCATTER_OPACITY },
    }
  }
  if (chart.type === 'bar' || chart.type === 'histogram') {
    const isHistogram = chart.type === 'histogram'
    return {
      ...base,
      type: 'bar',
      stack,
      large: true,
      largeThreshold: LARGE_BAR,
      ...(isHistogram
        ? { barCategoryGap: '4%' }
        : { barMaxWidth: BAR_MAX_WIDTH }),
      itemStyle: {
        borderRadius: stack ? 0 : [BAR_RADIUS, BAR_RADIUS, 0, 0],
        // The gap between the parts of a stacked bar has the colour of the background.
        ...(stack
          ? { borderColor: context.theme.background, borderWidth: 1 }
          : {}),
      },
    }
  }
  const isArea = chart.type === 'area'
  return {
    ...base,
    type: 'line',
    stack,
    symbol,
    symbolSize: SYMBOL_SIZE,
    showSymbol: data.length <= MAX_LINE_SYMBOLS,
    // The chart reduces the points of a line that has more points than pixels.
    sampling: 'lttb',
    lineStyle: {
      width: LINE_WIDTH,
      type: context.theme.isHighContrast
        ? DASHES[index % DASHES.length]
        : 'solid',
    },
    ...(isArea
      ? {
          areaStyle: {
            opacity: stack ? STACKED_AREA_OPACITY : AREA_OPACITY,
          },
        }
      : {}),
  }
}

function axisStyle(theme: ChartTheme) {
  return {
    nameTextStyle: { color: theme.textMuted },
    axisLine: { lineStyle: { color: theme.border } },
    axisTick: { lineStyle: { color: theme.border } },
    axisLabel: { color: theme.textMuted, hideOverlap: true },
  }
}

function zoomOption(chart: CartesianChart, theme: ChartTheme) {
  if (longestSeries(chart) <= ZOOM_FROM) return []
  return [
    { type: 'inside', xAxisIndex: 0 },
    {
      type: 'slider',
      xAxisIndex: 0,
      bottom: 4,
      height: ZOOM_HEIGHT - 20,
      borderColor: theme.border,
      textStyle: { color: theme.textMuted },
      brushSelect: false,
    },
  ]
}

/**
 * Makes the description of a chart for ECharts. This is the only place that
 * knows the options of the library. The description has no text of the user as
 * code: ECharts gets the names and the values as data.
 */
export function chartOption(
  prepared: CartesianChart,
  settings: ChartSettings,
  context: OptionContext,
): EChartsCoreOption {
  const { theme } = context
  const chart: CartesianChart =
    settings.stacked && isContinuous(prepared)
      ? { ...prepared, series: alignForStack(prepared.series) }
      : prepared
  const hasLegend = chart.series.length > 1
  const zoom = zoomOption(chart, theme)
  const isBar = chart.type === 'bar' || chart.type === 'histogram'

  return {
    backgroundColor: 'transparent',
    // The time axis shows the times as the result has them, not in the time zone of the computer.
    useUTC: true,
    animation: context.canAnimate && chart.pointCount <= MAX_ANIMATED_MARKS,
    color: theme.series,
    textStyle: { fontFamily: theme.font, color: theme.text },
    // In the high contrast theme, each series also has a pattern. The chart view
    // gives the description for a screen reader, thus ECharts makes none.
    aria: {
      enabled: true,
      label: { enabled: false },
      decal: { show: theme.isHighContrast },
    },
    grid: {
      left: 12,
      right: 20,
      top: hasLegend ? LEGEND_HEIGHT + 8 : 16,
      bottom: zoom.length > 0 ? ZOOM_HEIGHT : 8,
      // The limits of the grid are the limits of the labels and the names of the axes.
      outerBoundsMode: 'same',
      outerBoundsContain: 'all',
    },
    legend: hasLegend
      ? {
          type: 'scroll',
          top: 0,
          left: 12,
          textStyle: { color: theme.text },
          pageTextStyle: { color: theme.textMuted },
          pageIconColor: theme.text,
          pageIconInactiveColor: theme.border,
        }
      : undefined,
    tooltip: {
      trigger: chart.type === 'scatter' ? 'item' : 'axis',
      confine: true,
      backgroundColor: theme.surface,
      borderColor: theme.border,
      textStyle: { color: theme.text },
      axisPointer: {
        type: isBar ? 'shadow' : 'line',
        lineStyle: { color: theme.textMuted },
      },
      valueFormatter: (value: unknown) =>
        typeof value === 'number' ? formatNumber(value) : String(value ?? ''),
    },
    xAxis: {
      type: chart.xAxis,
      name: chart.xName,
      nameLocation: 'middle',
      nameGap: X_NAME_GAP,
      ...(chart.xAxis === 'category' ? { data: chart.categories } : {}),
      // A value axis that starts at zero wastes the space of a scatter plot.
      ...(chart.xAxis === 'value' ? { scale: true } : {}),
      splitLine: {
        show: chart.type === 'scatter',
        lineStyle: { color: theme.border },
      },
      ...axisStyle(theme),
    },
    yAxis: {
      type: settings.scale === 'log' ? 'log' : 'value',
      name: chart.yName ?? undefined,
      nameLocation: 'middle',
      // A bar starts at zero. A line or a point does not need the zero.
      scale: !isBar && chart.type !== 'area',
      splitLine: { lineStyle: { color: theme.border } },
      ...axisStyle(theme),
    },
    dataZoom: zoom,
    series: chart.series.map((series, index) =>
      seriesOption(chart, settings, series, index, context),
    ),
  }
}

/** `true` if the chart reduces the points of a line, because the line has more points than the chart has pixels. */
export function reducesPoints(chart: CartesianChart, widthPx: number): boolean {
  const isLine = chart.type === 'line' || chart.type === 'area'
  return isLine && widthPx > 0 && longestSeries(chart) > widthPx
}
