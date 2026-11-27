import type { ChartType } from './chartSettings'

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** The picture of a chart type. The button or the text next to it has the name. */
export function ChartTypeIcon({
  type,
  size = 20,
}: {
  type: ChartType
  size?: number
}) {
  return (
    <svg
      className="chart__type-icon"
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
    >
      {type === 'line' && (
        <path d="M3 17l5-6 4 3 8-9" strokeWidth="2" {...STROKE} />
      )}
      {type === 'area' && (
        <path
          d="M3 20V15l5-5 4 3 8-8v15z"
          strokeWidth="1.75"
          {...STROKE}
          fill="currentColor"
          fillOpacity="0.2"
        />
      )}
      {type === 'bar' && (
        <path
          d="M5 20V10M12 20V5M19 20v-7"
          strokeWidth="3"
          {...STROKE}
          strokeLinecap="butt"
        />
      )}
      {type === 'scatter' && (
        <g fill="currentColor">
          <circle cx="6" cy="17" r="2" />
          <circle cx="11" cy="11" r="2" />
          <circle cx="16" cy="14" r="2" />
          <circle cx="19" cy="6" r="2" />
        </g>
      )}
      {type === 'histogram' && (
        <path
          d="M4 20V14h4v6M8 20V6h4v14M12 20V10h4v10M16 20v-4h4v4M3 20h18"
          strokeWidth="1.75"
          {...STROKE}
        />
      )}
      {type === 'value' && (
        <text
          x="12"
          y="17"
          textAnchor="middle"
          fontSize="13"
          fontWeight="700"
          fill="currentColor"
        >
          12
        </text>
      )}
    </svg>
  )
}
