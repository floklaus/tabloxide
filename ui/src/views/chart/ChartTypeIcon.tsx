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
      {type === 'bubble' && (
        <g strokeWidth="1.75" {...STROKE}>
          <circle cx="8" cy="15" r="5" />
          <circle cx="17" cy="8" r="3" />
          <circle cx="18" cy="18" r="1.5" />
        </g>
      )}
      {type === 'boxplot' && (
        <path
          d="M12 3v4M12 17v4M9 3h6M9 21h6M6 7h12v10H6zM6 12h12"
          strokeWidth="1.75"
          {...STROKE}
        />
      )}
      {type === 'heatmap' && (
        <g>
          <path
            d="M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"
            strokeWidth="1.5"
            {...STROKE}
          />
          <path
            d="M4 4h5.3v5.3H4zM9.3 9.3h5.4v5.4H9.3zM14.7 14.7H20V20h-5.3z"
            fill="currentColor"
            fillOpacity="0.45"
          />
        </g>
      )}
      {type === 'calendar' && (
        <path
          d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4M8 14h2M14 14h2M8 17h2"
          strokeWidth="1.75"
          {...STROKE}
        />
      )}
      {type === 'pie' && (
        <path
          d="M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 0 0 0-17M12 12V3.5M12 12l7 4.8"
          strokeWidth="1.75"
          {...STROKE}
        />
      )}
      {type === 'funnel' && (
        <path d="M3 5h18l-7 8v6h-4v-6z" strokeWidth="1.75" {...STROKE} />
      )}
      {type === 'treemap' && (
        <path
          d="M4 4h16v16H4zM11 4v16M11 13h9M4 15h7"
          strokeWidth="1.75"
          {...STROKE}
        />
      )}
      {type === 'sunburst' && (
        <path
          d="M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 0 0 0-17M12 3.5V9M14.6 13.5l4.8 2.8M9.4 13.5l-4.8 2.8"
          strokeWidth="1.75"
          {...STROKE}
        />
      )}
      {type === 'radar' && (
        <path
          d="M12 3l8 5.5v8L12 21l-8-4.5v-8zM12 8l4 3v3.5L12 17l-3.5-2V10z"
          strokeWidth="1.75"
          {...STROKE}
        />
      )}
      {type === 'parallel' && (
        <path
          d="M5 4v16M12 4v16M19 4v16M5 8l7 8l7-9M5 15l7-7l7 9"
          strokeWidth="1.75"
          {...STROKE}
        />
      )}
      {type === 'sankey' && (
        <path
          d="M4 5v5M4 14v5M20 5v3M20 12v7M4 7.5c8 0 8 8 16 8M4 16.5c8 0 8-10 16-10"
          strokeWidth="1.75"
          {...STROKE}
        />
      )}
      {type === 'candlestick' && (
        <g strokeWidth="1.75" {...STROKE}>
          <path d="M8 3v4M8 15v5M5 7h6v8H5z" />
          <path
            d="M16 5v4M16 14v5M13 9h6v5h-6z"
            fill="currentColor"
            fillOpacity="0.45"
          />
        </g>
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
