import { useImperativeHandle, type ComponentProps } from 'react'
import type { ChartCanvas as RealChartCanvas } from './ChartCanvas'

/**
 * A replacement of the chart canvas for tests. jsdom has no canvas, thus ECharts
 * cannot draw. The replacement shows what the chart view gave to the canvas.
 */
export function ChartCanvas(props: ComponentProps<typeof RealChartCanvas>) {
  const { ref, chart, settings, summary } = props
  useImperativeHandle(ref, () => ({
    exportImage: (format) =>
      Promise.resolve(
        format === 'png'
          ? { format, base64: 'UE5H' }
          : { format, text: '<svg></svg>' },
      ),
  }))
  return (
    <div
      role="img"
      aria-label={summary}
      data-type={settings.type}
      data-series={
        chart.kind === 'cartesian'
          ? chart.series.map((series) => series.name).join('|')
          : undefined
      }
      data-points={chart.pointCount}
    />
  )
}
