import type { ComponentProps } from 'react'
import type { ChartCanvas as RealChartCanvas } from './ChartCanvas'

/**
 * A replacement of the chart canvas for tests. jsdom has no canvas, thus ECharts
 * cannot draw. The replacement shows what the chart view gave to the canvas.
 */
export function ChartCanvas(props: ComponentProps<typeof RealChartCanvas>) {
  const { chart, settings, summary } = props
  return (
    <div
      role="img"
      aria-label={summary}
      data-type={settings.type}
      data-series={chart.series.map((series) => series.name).join('|')}
      data-points={chart.pointCount}
    />
  )
}
