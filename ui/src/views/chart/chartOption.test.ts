import { describe, expect, test } from 'vitest'
import type { CartesianChart, ChartSeries } from './chartData'
import { chartOption, reducesPoints } from './chartOption'
import type { ChartSettings } from './chartSettings'
import type { ChartTheme } from './chartTheme'

const THEME: ChartTheme = {
  background: '#ffffff',
  surface: '#f4f5f7',
  text: '#1b1f27',
  textMuted: '#5b6472',
  border: '#d5d9e0',
  series: ['#111111', '#222222', '#333333'],
  font: 'system-ui',
  isHighContrast: false,
}
const CONTEXT = { theme: THEME, canAnimate: true }

type Option = {
  animation: boolean
  useUTC: boolean
  color: string[]
  legend?: object
  aria: { label: { enabled: boolean }; decal: { show: boolean } }
  xAxis: { type: string; data?: string[]; name: string }
  yAxis: { type: string; name?: string }
  dataZoom: { type: string }[]
  series: Record<string, unknown>[]
}

function chart(part: Partial<CartesianChart>): CartesianChart {
  return {
    kind: 'cartesian',
    type: 'bar',
    xAxis: 'category',
    xName: 'country',
    yName: 'amount',
    yColumns: ['amount'],
    countsRows: false,
    aggregate: null,
    isAutoAggregate: false,
    timeUnit: null,
    seriesColumn: null,
    categories: ['DE', 'FR'],
    series: [{ name: 'amount', values: [10, 20], points: [] }],
    pointCount: 2,
    notes: [],
    ...part,
  }
}

function points(name: string, data: [number, number][]): ChartSeries {
  return { name, values: [], points: data }
}

function option(
  prepared: CartesianChart,
  settings: ChartSettings,
  context = CONTEXT,
): Option {
  return chartOption(prepared, settings, context) as unknown as Option
}

const BAR: ChartSettings = { type: 'bar', x: 'country', y: ['amount'] }

describe('the description of a chart for ECharts', () => {
  test('a bar chart has the categories on the horizontal axis and the colours of the theme', () => {
    const result = option(chart({}), BAR)

    expect(result.xAxis).toMatchObject({
      type: 'category',
      name: 'country',
      data: ['DE', 'FR'],
    })
    expect(result.yAxis).toMatchObject({ type: 'value', name: 'amount' })
    expect(result.color).toEqual(THEME.series)
    expect(result.series[0]).toMatchObject({
      type: 'bar',
      name: 'amount',
      data: [10, 20],
    })
  })

  test('one series has no legend, and two series have one', () => {
    const two = chart({
      series: [
        { name: 'a', values: [1, 2], points: [] },
        { name: 'b', values: [3, 4], points: [] },
      ],
    })

    expect(option(chart({}), BAR).legend).toBeUndefined()
    expect(option(two, BAR).legend).toBeDefined()
  })

  test('a scatter plot always has the fast mode for many points', () => {
    const scatter = chart({
      type: 'scatter',
      xAxis: 'value',
      series: [points('weight', [[180, 80]])],
    })

    const result = option(scatter, { type: 'scatter', x: 'h', y: ['weight'] })

    expect(result.series[0]).toMatchObject({
      type: 'scatter',
      large: true,
      data: [[180, 80]],
    })
  })

  test('a line reduces its points and shows the times of the result without a change of the time zone', () => {
    const line = chart({
      type: 'line',
      xAxis: 'time',
      series: [points('v', [[0, 1]])],
    })

    const result = option(line, { type: 'line', x: 't', y: ['v'] })

    expect(result.useUTC).toBe(true)
    expect(result.xAxis.type).toBe('time')
    expect(result.series[0]).toMatchObject({ type: 'line', sampling: 'lttb' })
  })

  test('the name of the horizontal axis has the time unit', () => {
    const line = chart({
      type: 'line',
      xAxis: 'time',
      xName: 'day',
      timeUnit: 'month',
      series: [points('v', [[0, 1]])],
    })

    const result = option(line, { type: 'line', x: 'day', y: ['v'] })

    expect(result.xAxis.name).toBe('day (month)')
  })

  test('an area chart is a line with a filled area', () => {
    const area = chart({ type: 'area' })

    const result = option(area, { type: 'area', x: 'country', y: ['amount'] })

    expect(result.series[0]).toMatchObject({ type: 'line' })
    expect(result.series[0]).toHaveProperty('areaStyle')
  })

  test('a logarithmic scale applies to the vertical axis', () => {
    const result = option(chart({}), { ...BAR, scale: 'log' })

    expect(result.yAxis.type).toBe('log')
  })

  test('stacked series on a time axis get a value at each position', () => {
    const area = chart({
      type: 'area',
      xAxis: 'time',
      series: [
        points('a', [
          [1, 10],
          [2, 20],
        ]),
        points('b', [[2, 5]]),
      ],
    })

    const result = option(area, {
      type: 'area',
      x: 't',
      y: ['v'],
      stacked: true,
    })

    expect(result.series[0]).toMatchObject({ stack: 'total' })
    expect(result.series[1].data).toEqual([
      [1, 0],
      [2, 5],
    ])
  })

  test('a chart with many marks has a zoom control and no animation', () => {
    const many = 5000
    const line = chart({
      type: 'line',
      xAxis: 'value',
      series: [
        points(
          'v',
          Array.from({ length: many }, (_, index) => [index, index]),
        ),
      ],
      pointCount: many,
    })

    const result = option(line, { type: 'line', x: 'x', y: ['v'] })

    expect(result.dataZoom.map((zoom) => zoom.type)).toEqual([
      'inside',
      'slider',
    ])
    expect(result.animation).toBe(false)
  })

  test('a small chart has no zoom control', () => {
    expect(option(chart({}), BAR).dataZoom).toEqual([])
  })

  test('a chart does not move when the user asked the system for less motion', () => {
    const result = option(chart({}), BAR, { theme: THEME, canAnimate: false })

    expect(result.animation).toBe(false)
  })

  test('in the high contrast theme, each series has a pattern and each line its own style', () => {
    const context = {
      theme: { ...THEME, isHighContrast: true },
      canAnimate: true,
    }
    const lines = chart({
      type: 'line',
      series: [
        { name: 'a', values: [1, 2], points: [] },
        { name: 'b', values: [3, 4], points: [] },
      ],
    })

    const result = option(
      lines,
      { type: 'line', x: 'x', y: ['a', 'b'] },
      context,
    )

    expect(result.aria.decal.show).toBe(true)
    const styles = result.series.map(
      (series) => (series.lineStyle as { type: unknown }).type,
    )
    expect(new Set(styles).size).toBe(2)
  })

  test('the chart view gives the text for a screen reader, thus ECharts makes none', () => {
    expect(option(chart({}), BAR).aria.label.enabled).toBe(false)
  })
})

describe('reducesPoints', () => {
  const line = chart({
    type: 'line',
    xAxis: 'value',
    series: [
      points(
        'v',
        Array.from({ length: 900 }, (_, index) => [index, index]),
      ),
    ],
  })

  test('is true for a line with more points than the chart has pixels', () => {
    expect(reducesPoints(line, 800)).toBe(true)
  })

  test('is false for a line with fewer points', () => {
    expect(reducesPoints(line, 1000)).toBe(false)
  })

  test('is false for a bar chart, which shows each bar', () => {
    expect(reducesPoints(chart({}), 1)).toBe(false)
  })
})
