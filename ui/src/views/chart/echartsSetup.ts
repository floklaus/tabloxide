/**
 * The parts of ECharts that the chart view uses. The application loads this
 * module only when the user opens a chart, thus the start is not slower.
 */
import { BarChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  AriaComponent,
  CanvasRenderer,
  SVGRenderer,
])

export const init = echarts.init
export type { EChartsType } from 'echarts/core'
