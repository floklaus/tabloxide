import { Channel } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import {
  commands,
  type DownloadEvent,
  type Engine,
  type InstallResult,
} from '../bindings'
import { toMessage } from '../lib/errors'
import { useEngineStore } from './engineStore'

function failed(error: unknown): InstallResult {
  return { status: 'failed', message: toMessage(error) }
}

/**
 * Downloads and installs the official connector of `engine`. Call it only after the
 * user agreed: this is the first network request for connectors.
 */
export async function downloadConnector(
  engine: Engine,
  onEvent: (event: DownloadEvent) => void,
): Promise<InstallResult> {
  try {
    const result = await commands.connectorDownload(
      engine,
      new Channel<DownloadEvent>(onEvent),
    )
    if (result.status === 'error') return failed(result.error.message)
    if (result.data.status === 'installed') {
      await useEngineStore.getState().load()
    }
    return result.data
  } catch (error) {
    return failed(error)
  }
}

/** Asks for a package file. Returns `null` if the user cancelled. */
export async function choosePackage(): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [{ name: 'Connector package', extensions: ['gz'] }],
  })
  return typeof selected === 'string' ? selected : null
}

/** Reads a package file. It installs nothing. */
export async function inspectPackage(path: string): Promise<InstallResult> {
  try {
    const result = await commands.connectorInspectFile(path)
    return result.status === 'ok' ? result.data : failed(result.error.message)
  } catch (error) {
    return failed(error)
  }
}

/**
 * Installs a package file. `sha256` comes from `inspectPackage`, so that the install
 * uses the file that the user confirmed.
 */
export async function installPackage(
  path: string,
  sha256: string,
  confirmed: boolean,
): Promise<InstallResult> {
  try {
    const result = await commands.connectorInstallFile(path, sha256, confirmed)
    if (result.status === 'error') return failed(result.error.message)
    if (result.data.status === 'installed') {
      await useEngineStore.getState().load()
    }
    return result.data
  } catch (error) {
    return failed(error)
  }
}

/** Removes the installed connector of `engine`. Returns an error message, or `null`. */
export async function removeConnector(engine: Engine): Promise<string | null> {
  try {
    const result = await commands.connectorRemove(engine)
    await useEngineStore.getState().load()
    return result.status === 'ok' ? null : result.error.message
  } catch (error) {
    return toMessage(error)
  }
}

/** Formats a number of bytes for the user, for example "14.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
