import { useEffect, useState } from 'react'
import type { EngineEntry_Serialize } from '../bindings'
import { ConnectorDownloadDialog } from './ConnectorDownloadDialog'
import { removeConnector } from './connectorActions'
import { useEngineStore } from './engineStore'
import { InstallFromFile } from './InstallFromFile'

function sourceText(entry: EngineEntry_Serialize): string {
  const { source } = entry
  switch (source.type) {
    case 'built-in':
      return 'Built in'
    case 'installed':
      return `${source.version} · ${
        source.isOfficial
          ? 'Official'
          : `Other publisher: ${source.publisher ?? 'unknown'}`
      }`
    case 'development':
      return `${source.version} · Development: ${source.folder}`
    case 'available':
      return 'Not installed'
  }
}

/**
 * The Connectors tab of the Preferences dialog. It lists the engines and their
 * source, and it installs and removes connectors. The changes apply at once.
 */
export function ConnectorsSettings() {
  const engines = useEngineStore((state) => state.engines)
  const loadError = useEngineStore((state) => state.error)
  const [download, setDownload] = useState<string | null>(null)
  const [isInstallingFile, setIsInstallingFile] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void useEngineStore.getState().load()
  }, [])

  const remove = async (engine: string) => {
    setError(await removeConnector(engine))
  }

  return (
    <fieldset className="form__group">
      <legend>Connectors</legend>
      <p className="form__hint">
        A connector is a separate program that connects Tabloxide to one
        database engine. A connection starts its connector. A removed connector
        stops when its last connection closes.
      </p>
      <ul className="connector__list">
        {engines.map((entry) => (
          <li key={entry.info.engine} className="connector__row">
            <span className="connector__name">{entry.info.displayName}</span>
            <span className="connector__source">{sourceText(entry)}</span>
            {entry.source.type === 'installed' && (
              <button
                type="button"
                className="button button--small"
                onClick={() => void remove(entry.info.engine)}
              >
                Remove
              </button>
            )}
            {entry.source.type === 'available' && (
              <button
                type="button"
                className="button button--small"
                onClick={() => setDownload(entry.info.engine)}
              >
                Download…
              </button>
            )}
          </li>
        ))}
      </ul>
      {(error ?? loadError) && (
        <p className="message message--error" role="alert">
          {error ?? loadError}
        </p>
      )}
      <button
        type="button"
        className="button button--small"
        onClick={() => setIsInstallingFile(true)}
      >
        Install from a file…
      </button>
      {download !== null && (
        <ConnectorDownloadDialog
          engine={download}
          onInstalled={() => setDownload(null)}
          onClose={() => setDownload(null)}
        />
      )}
      {isInstallingFile && (
        <InstallFromFile
          onInstalled={() => setIsInstallingFile(false)}
          onClose={() => setIsInstallingFile(false)}
        />
      )}
    </fieldset>
  )
}
