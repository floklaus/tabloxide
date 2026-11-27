import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import type { ViewImage } from '../../bindings'
import { toMessage } from '../../lib/errors'
import { useThemeStore } from '../../theme/themeStore'
import { Loading, ViewError } from '../../view/ViewState'
import type { CartesianChart } from './chartData'
import { chartOption } from './chartOption'
import type { ChartSettings } from './chartSettings'
import { readChartTheme } from './chartTheme'
import type { EChartsType } from './echartsSetup'

export type ChartCanvasHandle = {
  /** Makes an image of the chart as it shows now, with its zoom. */
  exportImage: (format: ViewImage['format']) => Promise<ViewImage>
}

type Props = {
  ref?: Ref<ChartCanvasHandle>
  chart: CartesianChart
  settings: ChartSettings
  /** The text of the chart for a screen reader. */
  summary: string
  /** Tells the width of the chart in pixels, at the start and after each resize. */
  onWidth?: (width: number) => void
}

/** A PNG image has this number of pixels for each pixel of the chart on the screen. */
const PNG_PIXEL_RATIO = 2
const DARK_QUERY = '(prefers-color-scheme: dark)'
const LESS_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function matches(query: string): boolean {
  return window.matchMedia?.(query).matches ?? false
}

/** Changes when the system changes between its light and its dark setting. */
function useSystemDark(): boolean {
  const [isDark, setIsDark] = useState(() => matches(DARK_QUERY))
  useEffect(() => {
    const media = window.matchMedia?.(DARK_QUERY)
    if (!media) return
    const update = () => setIsDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return isDark
}

/**
 * Draws a chart with ECharts. This is the only component that has an instance
 * of the library. It loads the library when it mounts.
 */
export function ChartCanvas(props: Props) {
  const { ref, chart, settings, summary, onWidth } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<EChartsType | null>(null)
  const onWidthRef = useRef(onWidth)
  const [isReady, setIsReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const theme = useThemeStore((state) => state.theme)
  const isSystemDark = useSystemDark()

  useEffect(() => {
    onWidthRef.current = onWidth
  })

  useEffect(() => {
    let isDisposed = false
    let observer: ResizeObserver | null = null
    import('./echartsSetup')
      .then(({ init }) => {
        const host = hostRef.current
        if (isDisposed || !host) return
        const instance = init(host, null, { renderer: 'canvas' })
        instanceRef.current = instance
        observer = new ResizeObserver(() => {
          instance.resize()
          onWidthRef.current?.(instance.getWidth())
        })
        observer.observe(host)
        onWidthRef.current?.(instance.getWidth())
        setIsReady(true)
      })
      .catch((cause: unknown) => setLoadError(toMessage(cause)))
    return () => {
      isDisposed = true
      observer?.disconnect()
      instanceRef.current?.dispose()
      instanceRef.current = null
    }
  }, [])

  // The theme and the system setting change the colour tokens that the option reads.
  const built = useMemo(() => {
    void theme
    void isSystemDark
    try {
      const context = {
        theme: readChartTheme(),
        canAnimate: !matches(LESS_MOTION_QUERY),
      }
      return { option: chartOption(chart, settings, context), error: null }
    } catch (cause) {
      return { option: null, error: toMessage(cause) }
    }
  }, [chart, settings, theme, isSystemDark])

  useEffect(() => {
    if (!isReady || built.option === null) return
    // Without `notMerge`, the series of the last chart stay in the new chart.
    instanceRef.current?.setOption(built.option, { notMerge: true })
  }, [isReady, built])

  useImperativeHandle(ref, () => ({
    exportImage: async (format) => {
      const instance = instanceRef.current
      if (!instance) throw new Error('The chart is not ready.')
      const backgroundColor = readChartTheme().background
      if (format === 'png') {
        const url = instance.getDataURL({
          type: 'png',
          pixelRatio: PNG_PIXEL_RATIO,
          backgroundColor,
        })
        return { format, base64: url.slice(url.indexOf(',') + 1) }
      }
      // The chart on the screen is a canvas. A second instance without a
      // document element makes the SVG text, with the same zoom.
      const { init } = await import('./echartsSetup')
      const copy = init(null, null, {
        renderer: 'svg',
        ssr: true,
        width: instance.getWidth(),
        height: instance.getHeight(),
      })
      try {
        copy.setOption({
          ...instance.getOption(),
          animation: false,
          backgroundColor,
        })
        return { format, text: copy.renderToSVGString() }
      } finally {
        copy.dispose()
      }
    },
  }))

  const error = loadError ?? built.error
  return (
    <div className="chart__canvas">
      {error !== null && (
        <ViewError title="The chart cannot show." detail={error} />
      )}
      {!isReady && error === null && <Loading text="Loading the chart…" />}
      <div
        ref={hostRef}
        className="chart__plot"
        role="img"
        aria-label={summary}
      />
    </div>
  )
}
