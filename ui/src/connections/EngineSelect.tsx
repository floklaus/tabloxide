import type { Engine } from '../bindings'
import { engineLabel, useEngineStore } from '../engines/engineStore'

/** The value of the option that installs a connector from a file. */
export const INSTALL_FROM_FILE = '__install-from-file__'

type Props = {
  id?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  value: Engine
  onSelect: (engine: Engine) => void
}

/**
 * The engine list of the connection form: the built-in engines, the connectors, and
 * the official connectors to download. The selection of a connector that is not
 * installed asks before the download.
 */
export function EngineSelect({ value, onSelect, ...props }: Props) {
  const engines = useEngineStore((state) => state.engines)
  const builtIn = engines.filter((entry) => entry.source.type === 'built-in')
  const connectors = engines.filter((entry) => entry.source.type !== 'built-in')
  const isKnown = engines.some((entry) => entry.info.engine === value)

  return (
    <select
      {...props}
      value={value}
      onChange={(event) => onSelect(event.target.value)}
    >
      {!isKnown && (
        // A profile can name an engine whose connector is not installed.
        <option value={value}>{engineLabel(value)} (not installed)</option>
      )}
      <optgroup label="Built in">
        {builtIn.map((entry) => (
          <option key={entry.info.engine} value={entry.info.engine}>
            {entry.info.displayName}
          </option>
        ))}
      </optgroup>
      <optgroup label="Connectors">
        {connectors.map((entry) => (
          <option key={entry.info.engine} value={entry.info.engine}>
            {entry.info.displayName}
            {entry.source.type === 'available' ? ' (download)' : ''}
          </option>
        ))}
        <option value={INSTALL_FROM_FILE}>
          Install a connector from a file…
        </option>
      </optgroup>
    </select>
  )
}
