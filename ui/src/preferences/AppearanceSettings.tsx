import type { CSSProperties } from 'react'
import type { Density, LayoutName } from '../shell/shellStore'
import { THEME_LABELS, THEMES, type Theme } from '../theme/theme'

/** The colours of the small preview of each theme. They do not follow the current theme. */
type Swatch = { background: string; text: string; bars: string[] }

const SWATCHES: Record<Exclude<Theme, 'system'>, Swatch> = {
  light: {
    background: '#ffffff',
    text: '#1b1f27',
    bars: ['#b45309', '#e1e4ea'],
  },
  dark: {
    background: '#15181e',
    text: '#e6e9ef',
    bars: ['#f59e0b', '#323844'],
  },
  neon: {
    background: '#0d0221',
    text: '#00f0ff',
    bars: ['#ff2bd6', '#39ff14', '#fff200'],
  },
  'high-contrast': {
    background: '#000000',
    text: '#ffffff',
    bars: ['#ffd400', '#ffffff'],
  },
}

function SwatchPart({ swatch }: { swatch: Swatch }) {
  return (
    <span
      className="theme-card__part"
      style={
        { background: swatch.background, color: swatch.text } as CSSProperties
      }
    >
      <span className="theme-card__aa">Aa</span>
      <span className="theme-card__bars">
        {swatch.bars.map((colour, index) => (
          <span key={index} style={{ background: colour }} />
        ))}
      </span>
    </span>
  )
}

/** The system theme follows the operating system. Its preview shows light and dark. */
function Preview({ theme }: { theme: Theme }) {
  return (
    <span className="theme-card__preview" aria-hidden="true">
      {theme === 'system' ? (
        <>
          <SwatchPart swatch={SWATCHES.light} />
          <SwatchPart swatch={SWATCHES.dark} />
        </>
      ) : (
        <SwatchPart swatch={SWATCHES[theme]} />
      )}
    </span>
  )
}

const DENSITIES: { value: Density; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
]

export type Appearance = { theme: Theme; density: Density; layout: LayoutName }

type Props = {
  value: Appearance
  onChange: (value: Appearance) => void
}

/** The theme, the density, and the layout of the window. */
export function AppearanceSettings({ value, onChange }: Props) {
  return (
    <fieldset className="form__group">
      <legend>Appearance</legend>
      <p className="field__hint">
        System follows the light or dark setting of the operating system.
      </p>
      <div className="theme-cards" role="radiogroup" aria-label="Theme">
        {THEMES.map((theme) => (
          <label
            key={theme}
            className={`theme-card ${value.theme === theme ? 'theme-card--selected' : ''}`}
          >
            <Preview theme={theme} />
            <span className="theme-card__name">
              <input
                type="radio"
                name="theme"
                value={theme}
                checked={value.theme === theme}
                onChange={() => onChange({ ...value, theme })}
              />
              {THEME_LABELS[theme]}
            </span>
          </label>
        ))}
      </div>
      <div className="form__grid">
        <div className="field">
          <span className="field__label" id="density-label">
            Density
          </span>
          <div
            className="segmented"
            role="radiogroup"
            aria-labelledby="density-label"
          >
            {DENSITIES.map((density) => (
              <label
                key={density.value}
                className={`segmented__option ${value.density === density.value ? 'segmented__option--selected' : ''}`}
              >
                <input
                  type="radio"
                  name="density"
                  className="visually-hidden"
                  value={density.value}
                  checked={value.density === density.value}
                  onChange={() =>
                    onChange({ ...value, density: density.value })
                  }
                />
                {density.label}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="appearance-layout">
            Layout
          </label>
          <select
            id="appearance-layout"
            aria-describedby="appearance-layout-hint"
            value={value.layout}
            onChange={(event) =>
              onChange({ ...value, layout: event.target.value as LayoutName })
            }
          >
            <option value="standard">Standard</option>
            <option value="simple">Simple</option>
            {value.layout === 'custom' && (
              <option value="custom" disabled>
                Custom
              </option>
            )}
          </select>
          <span id="appearance-layout-hint" className="field__hint">
            Show or hide each panel in View › Panels.
          </span>
        </div>
      </div>
    </fieldset>
  )
}
