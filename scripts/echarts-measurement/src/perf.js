// Measures the time that ECharts needs to draw large charts.
// A time is from the start of the chart to the event `finished`.
import { echarts } from './register-all.js'
import { finish, log, mount, once, rng, settle } from './util.js'

const RUNS = 5
/** A draw that needs more time than this is not repeated. */
const SLOW_MS = 5000
const DRAW_TIMEOUT_MS = 30000
const POINTS = 100_000

const random = rng(42)
function walk(count) {
  const rows = new Array(count)
  let value = 100
  for (let i = 0; i < count; i++) {
    value += random() - 0.5
    rows[i] = [i, value]
  }
  return rows
}
function cloud(count) {
  const rows = new Array(count)
  for (let i = 0; i < count; i++) rows[i] = [random() * 1000, random() * 1000]
  return rows
}
/** The application gives each cell as text. The chart view must convert the cells. */
function textRows(count) {
  const rows = new Array(count)
  let value = 100
  for (let i = 0; i < count; i++) {
    value += random() - 0.5
    rows[i] = [
      new Date(Date.UTC(2024, 0, 1) + i * 60000).toISOString(),
      value.toFixed(4),
    ]
  }
  return rows
}

const line = walk(POINTS)
const longLine = walk(1_000_000)
const tenSeries = Array.from({ length: 10 }, () => walk(10_000))
const points = cloud(POINTS)
const bars = walk(POINTS).map(([i, value]) => [i, Math.abs(value)])
const cells = []
for (let i = 0; i < 500; i++)
  for (let j = 0; j < 200; j++) cells.push([i, j, (i * j) % 97])

const zoom = { dataZoom: [{ type: 'inside', start: 0, end: 100 }] }
const axes = {
  animation: false,
  xAxis: { type: 'value' },
  yAxis: { type: 'value', scale: true },
  ...zoom,
}
const scatter = (data, large) => ({
  ...axes,
  series: [{ type: 'scatter', symbolSize: 3, large, data }],
})

const cases = {
  'line, 100 000 points, no reduction': {
    ...axes,
    series: [{ type: 'line', showSymbol: false, data: line }],
  },
  'line, 100 000 points, reduction': {
    ...axes,
    series: [{ type: 'line', showSymbol: false, sampling: 'lttb', data: line }],
  },
  'line, 10 series of 10 000 points, reduction': {
    ...axes,
    series: tenSeries.map((data) => ({
      type: 'line',
      showSymbol: false,
      sampling: 'lttb',
      data,
    })),
  },
  'line, 1 000 000 points, reduction': {
    ...axes,
    series: [
      { type: 'line', showSymbol: false, sampling: 'lttb', data: longLine },
    ],
  },
  'scatter, 100 000 points, large mode': scatter(points, true),
  'scatter, 100 000 points, default mode': scatter(points, false),
  'bar, 100 000 bars, large mode': {
    ...axes,
    series: [{ type: 'bar', large: true, data: bars }],
  },
  'heat map, 100 000 cells': {
    animation: false,
    ...zoom,
    xAxis: { type: 'category' },
    yAxis: { type: 'category' },
    visualMap: { min: 0, max: 96, show: false },
    series: [{ type: 'heatmap', data: cells, progressive: 0 }],
  },
}
for (const count of [2000, 5000, 10_000, 50_000]) {
  const data = points.slice(0, count)
  cases[`scatter, ${count} points, default mode`] = scatter(data, false)
  cases[`scatter, ${count} points, large mode`] = scatter(data, true)
}

const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const out = {
  engine: navigator.userAgent,
  echarts: echarts.version,
  pixelRatio: devicePixelRatio,
  runs: RUNS,
  cases: {},
  errors: [],
}

// An error that ECharts throws in a later frame. `step` tells where the test was.
let step = ''
window.addEventListener('error', (event) =>
  out.errors.push({ step, message: event.message }),
)

async function measure(name, option, renderer = 'canvas') {
  log(name)
  const label = renderer === 'canvas' ? name : `${name}, ${renderer} renderer`
  const first = []
  const zoomed = []
  let timeout = false
  for (let run = 0; run < RUNS && !timeout; run++) {
    step = `${label}: first draw`
    const el = mount()
    const start = performance.now()
    const chart = echarts.init(el, null, { renderer })
    try {
      const drawn = once(chart, 'finished', DRAW_TIMEOUT_MS)
      chart.setOption(option)
      await drawn
      first.push(performance.now() - start)
      // A second draw: zoom to the middle half through the API. The time is to the next frame.
      step = `${label}: zoom`
      const zoomStart = performance.now()
      const frame = once(chart, 'rendered', DRAW_TIMEOUT_MS)
      chart.dispatchAction({ type: 'dataZoom', start: 25, end: 75 })
      await frame
      zoomed.push(performance.now() - zoomStart)
      await settle()
      step = `${label}: after the zoom frame`
      await settle()
    } catch {
      timeout = true
    }
    step = `${label}: after dispose`
    chart.dispose()
    el.remove()
    await settle()
    if (first.at(-1) > SLOW_MS) break
  }
  out.cases[label] = timeout
    ? { timeoutMs: DRAW_TIMEOUT_MS }
    : {
        firstMs: Math.round(median(first)),
        zoomMs: Math.round(median(zoomed)),
        runs: first.map(Math.round),
      }
}

// The conversion of text cells to dates and numbers.
{
  const rows = textRows(POINTS)
  const times = []
  for (let run = 0; run < RUNS; run++) {
    const start = performance.now()
    const data = new Array(rows.length)
    for (let i = 0; i < rows.length; i++)
      data[i] = [Date.parse(rows[i][0]), Number(rows[i][1])]
    times.push(performance.now() - start)
    if (Number.isNaN(data[POINTS - 1][1]))
      throw new Error('The conversion failed.')
  }
  out.convertMs = Math.round(median(times))
}

for (const [name, option] of Object.entries(cases)) await measure(name, option)
await measure(
  'line, 100 000 points, reduction',
  cases['line, 100 000 points, reduction'],
  'svg',
)
finish(out)
