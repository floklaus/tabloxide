/**
 * The descriptions for ECharts of the chart types that do not have two axes
 * with series: the parts of a whole, the relations, and the distributions.
 */
import type { EChartsCoreOption } from 'echarts/core'
import type {
  BoxChart,
  CartesianChart,
  DrawnChart,
  RowsChart,
} from './chartData'
import { OTHER_NAME } from './chartData'
import {
  axisStyle,
  chartOption,
  DASHES,
  MAX_ANIMATED_MARKS,
  SYMBOLS,
  ZOOM_HEIGHT,
  zoomControl,
  type OptionContext,
} from './chartOption'
import { candles, sankeyLinks } from './chartOtherData'
import type { ChartSettings } from './chartSettings'
import type { ChartTheme } from './chartTheme'
import { formatNumber } from './chartValues'

const LEGEND_HEIGHT = 32
/** The text on a coloured area is white with a dark border, thus each colour of the series can be behind it. */
const ON_COLOUR = {
  color: '#ffffff',
  textBorderColor: 'rgba(0, 0, 0, 0.55)',
  textBorderWidth: 2,
}
/** The share of the height that a calendar keeps free for the colour scale. */
const CALENDAR_SCALE_SHARE = 12
const LENGTH_OF_YEAR = 4

/**
 * The parts of a description that each chart type has. A chart with a colour
 * scale has no patterns: a pattern hides the colour of a cell.
 */
function base(context: OptionContext, marks: number, hasScale = false) {
  const { theme } = context
  return {
    backgroundColor: 'transparent',
    // A date shows as the result has it, not in the time zone of the computer.
    useUTC: true,
    animation: context.canAnimate && marks <= MAX_ANIMATED_MARKS,
    color: theme.series,
    textStyle: { fontFamily: theme.font, color: theme.text },
    aria: {
      enabled: true,
      label: { enabled: false },
      decal: { show: theme.isHighContrast && !hasScale },
    },
    tooltip: {
      trigger: 'item',
      confine: true,
      backgroundColor: theme.surface,
      borderColor: theme.border,
      textStyle: { color: theme.text },
      valueFormatter: (value: unknown) =>
        typeof value === 'number' ? formatNumber(value) : String(value ?? ''),
    },
  }
}

function legend(theme: ChartTheme) {
  return {
    type: 'scroll',
    top: 0,
    left: 12,
    textStyle: { color: theme.text },
    pageTextStyle: { color: theme.textMuted },
    pageIconColor: theme.text,
    pageIconInactiveColor: theme.border,
  }
}

/** The values of the first series for each category, without empty values and without values that a part of a whole cannot have. */
function parts(chart: CartesianChart, theme: ChartTheme) {
  const [series] = chart.series
  const hasOther = chart.limit?.hasOther === true
  return chart.categories.flatMap((name, index) => {
    const value = series.values[index]
    if (value === null || value <= 0) return []
    const isOther =
      hasOther && index === chart.categories.length - 1 && name === OTHER_NAME
    return [
      {
        name,
        value,
        // "Other" is not one more category. It has a neutral colour.
        ...(isOther ? { itemStyle: { color: theme.textMuted } } : {}),
      },
    ]
  })
}

function pieOption(chart: CartesianChart, context: OptionContext) {
  const { theme } = context
  return {
    ...base(context, chart.pointCount),
    series: [
      {
        type: 'pie',
        radius: '68%',
        center: ['50%', '52%'],
        data: parts(chart, theme),
        // The name and the share are at each slice, thus the chart needs no legend.
        label: { color: theme.text, formatter: '{b}: {d}%' },
        labelLine: { lineStyle: { color: theme.textMuted } },
        itemStyle: { borderColor: theme.background, borderWidth: 2 },
      },
    ],
  }
}

function funnelOption(chart: CartesianChart, context: OptionContext) {
  const { theme } = context
  return {
    ...base(context, chart.pointCount),
    // The stages are one sequence, not different things. They have one colour.
    color: [theme.series[0]],
    series: [
      {
        type: 'funnel',
        // The stages keep the sequence of the result or of the sort setting.
        sort: 'none',
        left: '12%',
        width: '60%',
        top: 16,
        bottom: 16,
        minSize: '2%',
        gap: 2,
        data: parts(chart, theme),
        label: { position: 'right', color: theme.text, formatter: '{b}: {c}' },
        labelLine: { lineStyle: { color: theme.textMuted } },
        itemStyle: { borderWidth: 0 },
      },
    ],
  }
}

type TreeNode = { name: string; value?: number; children?: TreeNode[] }

/** The groups and their subgroups. Without a series column, the tree has one level. */
function tree(chart: CartesianChart): TreeNode[] {
  if (chart.seriesColumn === null) {
    return parts(chart, { textMuted: '' } as ChartTheme).map((part) => ({
      name: part.name,
      value: part.value,
    }))
  }
  return chart.categories.flatMap((name, index) => {
    const children = chart.series.flatMap((series) => {
      const value = series.values[index]
      return value === null || value <= 0 ? [] : [{ name: series.name, value }]
    })
    return children.length === 0 ? [] : [{ name, children }]
  })
}

function treemapOption(chart: CartesianChart, context: OptionContext) {
  const { theme } = context
  // A group shows its name in a band above its parts. The band has the colour of a surface.
  const gap = { borderColor: theme.surface, borderWidth: 0, gapWidth: 2 }
  return {
    ...base(context, chart.pointCount),
    series: [
      {
        type: 'treemap',
        left: 4,
        right: 4,
        top: 4,
        bottom: 4,
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        data: tree(chart),
        label: { show: true, ...ON_COLOUR },
        upperLabel: {
          show: chart.seriesColumn !== null,
          height: 20,
          color: theme.text,
        },
        levels: [
          { itemStyle: gap },
          { itemStyle: { ...gap, gapWidth: 1 }, colorSaturation: [0.35, 0.6] },
        ],
      },
    ],
  }
}

function sunburstOption(chart: CartesianChart, context: OptionContext) {
  const { theme } = context
  return {
    ...base(context, chart.pointCount),
    series: [
      {
        type: 'sunburst',
        radius: ['12%', '92%'],
        data: tree(chart),
        label: { rotate: 'radial', minAngle: 6, ...ON_COLOUR },
        itemStyle: { borderColor: theme.background, borderWidth: 2 },
        emphasis: { focus: 'ancestor' },
      },
    ],
  }
}

/** Returns a round number that is not smaller than `value`, for the end of an axis. */
function roundUp(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / power) * power
}

function radarOption(chart: CartesianChart, context: OptionContext) {
  const { theme } = context
  const values = chart.series.flatMap((series) =>
    series.values.filter((value) => value !== null),
  )
  // All axes have the same scale, thus the form of a series is true.
  const max = roundUp(Math.max(0, ...values))
  const min = Math.min(0, ...values)
  const line = { lineStyle: { color: theme.border } }
  return {
    ...base(context, chart.pointCount),
    legend: chart.series.length > 1 ? legend(theme) : undefined,
    radar: {
      center: ['50%', '54%'],
      radius: '68%',
      indicator: chart.categories.map((name) => ({ name, max, min })),
      axisName: { color: theme.textMuted },
      axisLine: line,
      splitLine: line,
      splitArea: { show: false },
    },
    series: [
      {
        type: 'radar',
        data: chart.series.map((series, index) => ({
          name: series.name,
          value: series.values.map((value) => value ?? 0),
          symbol: SYMBOLS[index % SYMBOLS.length],
          symbolSize: 6,
          lineStyle: {
            width: 2,
            type: theme.isHighContrast
              ? DASHES[index % DASHES.length]
              : 'solid',
            ...(chart.otherSeries.includes(index)
              ? { color: theme.textMuted }
              : {}),
          },
          areaStyle: { opacity: 0.08 },
        })),
      },
    ],
  }
}

/** The colour scale of a heat map, below the chart. */
function colourScale(values: number[], theme: ChartTheme) {
  let min = Infinity
  let max = -Infinity
  for (const value of values) {
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  return {
    min,
    // A scale needs two different ends.
    max: max === min ? min + 1 : max,
    calculable: false,
    // The two ends of the scale show their values.
    text: [formatNumber(max), formatNumber(min)],
    orient: 'horizontal',
    left: 'center',
    bottom: 4,
    itemWidth: 12,
    itemHeight: 140,
    inRange: { color: theme.ramp },
    textStyle: { color: theme.textMuted },
    formatter: (value: unknown) =>
      typeof value === 'number' ? formatNumber(value) : String(value),
  }
}

function heatmapOption(chart: CartesianChart, context: OptionContext) {
  const { theme } = context
  const cells = chart.series.flatMap((series, row) =>
    series.values.flatMap((value, column) =>
      value === null ? [] : [[column, row, value]],
    ),
  )
  const axis = { type: 'category', nameLocation: 'middle', ...axisStyle(theme) }
  return {
    ...base(context, chart.pointCount, true),
    grid: {
      left: 12,
      right: 20,
      top: 12,
      bottom: 52,
      outerBoundsMode: 'same',
      outerBoundsContain: 'all',
    },
    xAxis: { ...axis, data: chart.categories, name: chart.xName, nameGap: 28 },
    yAxis: {
      ...axis,
      data: chart.series.map((series) => series.name),
      name: chart.seriesColumn ?? undefined,
    },
    visualMap: colourScale(
      cells.map((cell) => cell[2]),
      theme,
    ),
    // A heat map has no zoom. With a zoom, ECharts 6.1.0 gives an error after
    // the chart is gone (section 14.6 of the visualization design).
    series: [
      {
        type: 'heatmap',
        data: cells,
        itemStyle: { borderColor: theme.background, borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: theme.text, borderWidth: 1 } },
      },
    ],
  }
}

function calendarOption(chart: CartesianChart, context: OptionContext) {
  const { theme } = context
  const [series] = chart.series
  const days = chart.categories.flatMap((day, index) => {
    const value = series.values[index]
    return value === null ? [] : [[day, value] as [string, number]]
  })
  const years = [...new Set(days.map(([day]) => day.slice(0, LENGTH_OF_YEAR)))]
  // Each year has the same share of the height above the colour scale.
  const share = (100 - CALENDAR_SCALE_SHARE) / years.length
  return {
    ...base(context, chart.pointCount, true),
    visualMap: colourScale(
      days.map(([, value]) => value),
      theme,
    ),
    calendar: years.map((year, index) => ({
      range: year,
      top: `${index * share + share * 0.24}%`,
      bottom: `${(years.length - 1 - index) * share + share * 0.06 + CALENDAR_SCALE_SHARE}%`,
      left: 64,
      right: 16,
      cellSize: ['auto', 'auto'],
      // A week starts on Monday, as the time unit "week" does.
      dayLabel: { firstDay: 1, color: theme.textMuted },
      monthLabel: { color: theme.textMuted },
      yearLabel: { color: theme.text, fontSize: 14 },
      itemStyle: {
        color: theme.background,
        borderColor: theme.border,
        borderWidth: 1,
      },
      splitLine: { lineStyle: { color: theme.textMuted } },
    })),
    series: years.map((year, index) => ({
      type: 'heatmap',
      coordinateSystem: 'calendar',
      calendarIndex: index,
      data: days.filter(([day]) => day.startsWith(year)),
    })),
  }
}

function sankeyOption(chart: CartesianChart, context: OptionContext) {
  const { theme } = context
  const links = sankeyLinks(chart)
  const names = [
    ...new Set(links.flatMap((link) => [link.source, link.target])),
  ]
  return {
    ...base(context, chart.pointCount),
    series: [
      {
        type: 'sankey',
        left: 12,
        right: 140,
        top: 12,
        bottom: 12,
        data: names.map((name) => ({ name })),
        links,
        draggable: false,
        nodeGap: 10,
        label: { color: theme.text },
        lineStyle: { color: 'gradient', opacity: 0.4, curveness: 0.5 },
        emphasis: { focus: 'adjacency' },
      },
    ],
  }
}

function cartesianGrid(hasZoom: boolean, top = 16) {
  return {
    left: 12,
    right: 20,
    top,
    bottom: hasZoom ? ZOOM_HEIGHT : 8,
    outerBoundsMode: 'same',
    outerBoundsContain: 'all',
  }
}

function candlestickOption(chart: CartesianChart, context: OptionContext) {
  const { theme } = context
  const [up, down] = theme.series
  const zoom = zoomControl(chart.categories.length, theme)
  return {
    ...base(context, chart.pointCount),
    tooltip: {
      ...base(context, 0).tooltip,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
    },
    grid: cartesianGrid(zoom.length > 0),
    xAxis: {
      type: 'category',
      data: chart.categories,
      name: chart.xName,
      nameLocation: 'middle',
      nameGap: 28,
      ...axisStyle(theme),
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: theme.border } },
      ...axisStyle(theme),
    },
    dataZoom: zoom,
    series: [
      {
        type: 'candlestick',
        // ECharts wants open, close, low, high. A row without the four values has no candle.
        data: candles(chart).map((candle) => {
          if (candle.values === null) return '-'
          const [open, high, low, close] = candle.values
          return [open, close, low, high]
        }),
        // A candle that closes higher is full. A candle that closes lower is
        // empty and has a different colour. Thus colour is not the only sign.
        itemStyle: {
          color: up,
          borderColor: up,
          color0: theme.background,
          borderColor0: down,
          borderWidth: 1.5,
        },
      },
    ],
  }
}

function boxOption(chart: BoxChart, context: OptionContext) {
  const { theme } = context
  const [box, outlier] = theme.series
  return {
    ...base(context, chart.pointCount + chart.outliers.length),
    grid: cartesianGrid(false),
    xAxis: {
      type: 'category',
      data: chart.categories,
      name: chart.xName ?? undefined,
      nameLocation: 'middle',
      nameGap: 28,
      ...axisStyle(theme),
    },
    yAxis: {
      type: 'value',
      scale: true,
      name: chart.yName,
      nameLocation: 'middle',
      splitLine: { lineStyle: { color: theme.border } },
      ...axisStyle(theme),
    },
    series: [
      {
        type: 'boxplot',
        name: chart.yName,
        data: chart.boxes,
        boxWidth: [8, 48],
        itemStyle: { color: theme.surface, borderColor: box, borderWidth: 1.5 },
      },
      {
        type: 'scatter',
        name: 'Values outside the whiskers',
        data: chart.outliers.map(([index, value]) => [
          chart.categories[index],
          value,
        ]),
        symbolSize: 5,
        itemStyle: { color: outlier },
      },
    ],
  }
}

function parallelOption(chart: RowsChart, context: OptionContext) {
  const { theme } = context
  const hasLegend = chart.groups.length > 1
  const line = { lineStyle: { color: theme.textMuted } }
  // Many lines are on top of each other. A low opacity shows where they are dense.
  const opacity = chart.pointCount > 500 ? 0.2 : 0.5
  return {
    ...base(context, chart.pointCount),
    // A row has no name, thus a tooltip of one line has no use.
    tooltip: { show: false },
    legend: hasLegend ? legend(theme) : undefined,
    parallel: {
      left: 48,
      right: 72,
      top: hasLegend ? LEGEND_HEIGHT + 32 : 40,
      bottom: 24,
      parallelAxisDefault: {
        nameTextStyle: { color: theme.text },
        axisLine: line,
        axisTick: line,
        axisLabel: { color: theme.textMuted },
        scale: true,
      },
    },
    parallelAxis: chart.axes.map((name, dim) => ({ dim, name })),
    series: chart.groups.map((group, index) => ({
      type: 'parallel',
      name: group.name,
      data: group.lines,
      lineStyle: {
        width: 1,
        opacity,
        ...(chart.otherSeries.includes(index)
          ? { color: theme.textMuted }
          : {}),
      },
    })),
  }
}

/**
 * Makes the description of a chart for ECharts, for each chart type. The chart
 * types with two axes and series use `chartOption`.
 */
export function drawOption(
  chart: DrawnChart,
  settings: ChartSettings,
  context: OptionContext,
): EChartsCoreOption {
  if (chart.kind === 'box') return boxOption(chart, context)
  if (chart.kind === 'rows') return parallelOption(chart, context)
  switch (chart.type) {
    case 'pie':
      return pieOption(chart, context)
    case 'funnel':
      return funnelOption(chart, context)
    case 'treemap':
      return treemapOption(chart, context)
    case 'sunburst':
      return sunburstOption(chart, context)
    case 'radar':
      return radarOption(chart, context)
    case 'heatmap':
      return heatmapOption(chart, context)
    case 'calendar':
      return calendarOption(chart, context)
    case 'sankey':
      return sankeyOption(chart, context)
    case 'candlestick':
      return candlestickOption(chart, context)
    default:
      return chartOption(chart, settings, context)
  }
}
