// Draws each chart type under the content security policy of the application, and
// records each violation of the policy. The runner reads `window.__results`.
import { echarts } from './register-all.js'
import { finish, mount, once, rng } from './util.js'

const violations = []
document.addEventListener('securitypolicyviolation', (e) => {
  violations.push({
    directive: e.violatedDirective,
    blocked: e.blockedURI,
    phase: window.__phase,
  })
})

const r = rng(7)
const cats = ['A', 'B', 'C', 'D', 'E', 'F']
const xy = Array.from({ length: 200 }, (_, i) => [i, Math.round(r() * 100)])
const base = {
  animation: false,
  aria: { enabled: true, decal: { show: true } },
  tooltip: {},
}
const grid = { xAxis: { type: 'category', data: cats }, yAxis: {} }

const cases = {
  line: {
    xAxis: {},
    yAxis: {},
    dataZoom: [{ type: 'inside' }, { type: 'slider' }],
    series: [{ type: 'line', data: xy, sampling: 'lttb' }],
  },
  area: {
    xAxis: {},
    yAxis: {},
    series: [
      { type: 'line', areaStyle: {}, stack: 's', data: xy },
      { type: 'line', areaStyle: {}, stack: 's', data: xy },
    ],
  },
  bar: {
    ...grid,
    legend: {},
    series: [
      { type: 'bar', name: 'a', stack: 's', data: [3, 5, 2, 8, 1, 4] },
      { type: 'bar', name: 'b', stack: 's', data: [1, 2, 3, 4, 5, 6] },
    ],
  },
  'bar-log': {
    xAxis: { type: 'category', data: cats },
    yAxis: { type: 'log' },
    series: [{ type: 'bar', data: [1, 10, 100, 1000, 5, 50] }],
  },
  scatter: {
    xAxis: {},
    yAxis: {},
    series: [{ type: 'scatter', data: xy, symbolSize: 6 }],
  },
  bubble: {
    xAxis: {},
    yAxis: {},
    visualMap: { dimension: 2, min: 0, max: 100 },
    series: [
      { type: 'scatter', data: xy.map(([x, y]) => [x, y, (x * 7) % 100]) },
    ],
  },
  'time-axis': {
    xAxis: { type: 'time' },
    yAxis: {},
    series: [
      {
        type: 'line',
        data: xy.map(([x, y]) => [Date.UTC(2024, 0, 1) + x * 864e5, y]),
      },
    ],
  },
  dataset: {
    dataset: {
      source: [
        ['day', 'a', 'b'],
        ['mon', 1, 2],
        ['tue', 3, 1],
        ['wed', 2, 5],
      ],
    },
    xAxis: { type: 'category' },
    yAxis: {},
    series: [{ type: 'bar' }, { type: 'line' }],
  },
  pie: {
    series: [
      {
        type: 'pie',
        radius: ['30%', '60%'],
        data: cats.map((name, i) => ({ name, value: i + 1 })),
      },
    ],
  },
  heatmap: {
    xAxis: { type: 'category', data: cats },
    yAxis: { type: 'category', data: cats },
    visualMap: { min: 0, max: 36 },
    series: [
      {
        type: 'heatmap',
        data: cats.flatMap((_, i) => cats.map((_, j) => [i, j, i * j])),
      },
    ],
  },
  calendar: {
    visualMap: { min: 0, max: 100, orient: 'horizontal' },
    calendar: { range: '2024' },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: Array.from({ length: 366 }, (_, i) => [
          echarts.time.format(
            Date.UTC(2024, 0, 1) + i * 864e5,
            '{yyyy}-{MM}-{dd}',
            true,
          ),
          Math.round(r() * 100),
        ]),
      },
    ],
  },
  boxplot: {
    dataset: [
      {
        source: [
          [1, 5, 3, 9, 4, 6, 2],
          [7, 3, 8, 12, 5, 9, 30],
          [2, 2, 3, 4, 3, 2, 1],
        ],
      },
      { transform: { type: 'boxplot' } },
      { fromDatasetIndex: 1, fromTransformResult: 1 },
    ],
    xAxis: { type: 'category' },
    yAxis: {},
    series: [
      { type: 'boxplot', datasetIndex: 1 },
      { type: 'scatter', datasetIndex: 2 },
    ],
  },
  treemap: {
    series: [
      {
        type: 'treemap',
        data: [
          {
            name: 'a',
            value: 10,
            children: [
              { name: 'a1', value: 4 },
              { name: 'a2', value: 6 },
            ],
          },
          { name: 'b', value: 20 },
        ],
      },
    ],
  },
  sunburst: {
    series: [
      {
        type: 'sunburst',
        data: [
          {
            name: 'a',
            children: [
              { name: 'a1', value: 4 },
              { name: 'a2', value: 6 },
            ],
          },
          { name: 'b', value: 20 },
        ],
      },
    ],
  },
  funnel: {
    series: [
      {
        type: 'funnel',
        data: cats.map((name, i) => ({ name, value: 60 - i * 10 })),
      },
    ],
  },
  parallel: {
    parallel: {},
    parallelAxis: [
      { dim: 0, name: 'a' },
      { dim: 1, name: 'b' },
      { dim: 2, name: 'c' },
    ],
    series: [
      {
        type: 'parallel',
        data: xy.slice(0, 50).map(([x, y]) => [x, y, x + y]),
      },
    ],
  },
  radar: {
    radar: { indicator: cats.map((name) => ({ name, max: 10 })) },
    series: [{ type: 'radar', data: [{ value: [3, 5, 2, 8, 1, 4] }] }],
  },
  sankey: {
    series: [
      {
        type: 'sankey',
        data: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }],
        links: [
          { source: 'a', target: 'c', value: 5 },
          { source: 'b', target: 'c', value: 3 },
          { source: 'c', target: 'd', value: 8 },
        ],
      },
    ],
  },
  candlestick: {
    xAxis: { type: 'category', data: cats },
    yAxis: { scale: true },
    series: [
      {
        type: 'candlestick',
        data: cats.map((_, i) => [20 + i, 24 + i, 18 + i, 26 + i]),
      },
    ],
  },
  graph: {
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        data: Array.from({ length: 30 }, (_, i) => ({ name: 'n' + i })),
        links: Array.from({ length: 40 }, (_, i) => ({
          source: 'n' + (i % 30),
          target: 'n' + ((i * 7 + 3) % 30),
        })),
      },
    ],
  },
  'formatter-string': {
    ...grid,
    tooltip: { trigger: 'axis', formatter: '{b}: {c}' },
    series: [
      {
        type: 'bar',
        data: [3, 5, 2, 8, 1, 4],
        label: { show: true, formatter: '{c} units' },
      },
    ],
  },
  'formatter-function': {
    ...grid,
    tooltip: {
      trigger: 'axis',
      formatter: (p) => `${p[0].name}: ${p[0].value}`,
    },
    series: [
      {
        type: 'bar',
        data: [3, 5, 2, 8, 1, 4],
        label: { show: true, formatter: (p) => `${p.value}!` },
      },
    ],
  },
  toolbox: {
    ...grid,
    toolbox: {
      feature: { saveAsImage: {}, dataZoom: {}, restore: {}, dataView: {} },
    },
    series: [{ type: 'bar', data: [3, 5, 2, 8, 1, 4] }],
  },
}

const out = {
  engine: navigator.userAgent,
  echarts: echarts.version,
  cases: {},
  violations,
}

async function one(name, option, renderer) {
  const id = `${name}/${renderer}`
  window.__phase = id
  const el = mount(700, 350)
  const result = { ok: false }
  try {
    const chart = echarts.init(el, null, { renderer })
    const done = once(chart, 'finished', 15000)
    chart.setOption({ ...base, ...option, tooltip: option.tooltip ?? {} })
    await done
    try {
      chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 1 })
    } catch (e) {
      result.tipError = String(e)
    }
    chart.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: 1 })
    const url = chart.getDataURL({ type: renderer === 'svg' ? 'svg' : 'png' })
    result.image = url.slice(0, 22)
    result.aria = (el.getAttribute('aria-label') ?? '').length
    result.marks =
      renderer === 'svg'
        ? el.querySelectorAll('path,rect,circle,text').length
        : el.querySelectorAll('canvas').length
    result.ok = true
    chart.dispose()
  } catch (e) {
    result.error = String(e)
  }
  el.remove()
  out.cases[id] = result
}

for (const [name, option] of Object.entries(cases)) {
  await one(name, option, 'canvas')
  await one(name, option, 'svg')
}
// Let late violation events arrive.
await new Promise((r) => setTimeout(r, 300))
out.violationsBeforeControl = violations.length
// Control: the policy must refuse string evaluation in this page. If it does not,
// the server did not send the policy, and the test proves nothing.
window.__phase = 'control'
try {
  new Function('return 1')()
  out.evalBlocked = false
} catch {
  out.evalBlocked = true
}
await new Promise((r) => setTimeout(r, 300))
finish(out)
