import { normalize, type ChartSettings } from './chartSettings'
import { ChartTypeIcon } from './ChartTypeIcon'
import { suggestionLabel } from './proposeChart'

type Props = {
  /** The charts that the fixed rules propose, with the best fit first. */
  suggestions: ChartSettings[]
  /** The settings that the chart shows. */
  settings: ChartSettings
  /** `true` if the chart has no settings of the user: it shows the first suggestion. */
  isProposed: boolean
  /** Selects a suggestion. `undefined` removes the settings of the user. */
  onSelect: (settings: ChartSettings | undefined) => void
}

const ICON_SIZE = 16

function isSame(a: ChartSettings, b: ChartSettings): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}

/**
 * The charts that Tabloxide proposes for a result. A selection replaces the
 * chart settings. The first suggestion is the chart of a result without settings.
 */
export function SuggestedCharts(props: Props) {
  const { suggestions, settings, isProposed, onSelect } = props
  if (suggestions.length === 0) return null
  return (
    <div
      className="chart__suggestions"
      role="group"
      aria-label="Suggested charts"
    >
      <span className="chart__label">Suggested charts</span>
      {suggestions.map((suggestion, index) => {
        const label = suggestionLabel(suggestion)
        const isFirst = index === 0
        return (
          <button
            key={label}
            type="button"
            className="button button--small chart__suggestion"
            aria-pressed={
              isFirst && isProposed ? true : isSame(suggestion, settings)
            }
            // The first suggestion removes the settings. Thus a new run with
            // different columns gets a new proposal, not an error.
            onClick={() => onSelect(isFirst ? undefined : suggestion)}
          >
            <ChartTypeIcon type={suggestion.type} size={ICON_SIZE} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
