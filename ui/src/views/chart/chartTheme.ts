/** The colours of a chart. They come from the colour tokens of the theme. */
export type ChartTheme = {
  background: string
  surface: string
  text: string
  textMuted: string
  border: string
  /** The colours of the series, in a fixed sequence. */
  series: string[]
  font: string
  /** In the high contrast theme, the series also have different patterns and line styles. */
  isHighContrast: boolean
}

/** The number of `--chart-N` tokens of the style sheet. */
export const SERIES_COLOURS = 8

/** Reads the chart colours of the theme that the document has now. */
export function readChartTheme(): ChartTheme {
  const root = document.documentElement
  const style = getComputedStyle(root)
  const token = (name: string) => style.getPropertyValue(name).trim()
  return {
    background: token('--color-bg'),
    surface: token('--color-surface'),
    text: token('--color-text'),
    textMuted: token('--color-text-muted'),
    border: token('--color-border'),
    series: Array.from({ length: SERIES_COLOURS }, (_, index) =>
      token(`--chart-${index + 1}`),
    ),
    font: token('--font-ui'),
    isHighContrast: root.dataset.theme === 'high-contrast',
  }
}
