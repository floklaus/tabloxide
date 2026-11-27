/**
 * The parts of ECharts that the chart view uses. The application loads this
 * module only when the user opens a chart, thus the start is not slower.
 */
import {
  BarChart,
  BoxplotChart,
  CandlestickChart,
  FunnelChart,
  HeatmapChart,
  LineChart,
  ParallelChart,
  PieChart,
  RadarChart,
  SankeyChart,
  ScatterChart,
  SunburstChart,
  TreemapChart,
} from 'echarts/charts'
import {
  AriaComponent,
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  ParallelComponent,
  RadarComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  PieChart,
  FunnelChart,
  TreemapChart,
  SunburstChart,
  RadarChart,
  ParallelChart,
  SankeyChart,
  HeatmapChart,
  BoxplotChart,
  CandlestickChart,
  GridComponent,
  CalendarComponent,
  ParallelComponent,
  RadarComponent,
  VisualMapComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  AriaComponent,
  CanvasRenderer,
  SVGRenderer,
])

export const init = echarts.init
export type { EChartsType } from 'echarts/core'
