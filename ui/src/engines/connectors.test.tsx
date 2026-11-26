import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands, type DownloadEvent } from '../bindings'
import {
  toDraft,
  toProfile,
  withEngine,
  type ConnectionDraft,
} from '../connections/formModel'
import { makeProfile } from '../test/fixtures'
import { ConnectorDownloadDialog } from './ConnectorDownloadDialog'
import { DEFAULT_ENGINES, useEngineStore } from './engineStore'
import { InstallFromFile } from './InstallFromFile'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue('/downloads/x.tar.gz'),
}))

const download = vi.mocked(commands.connectorDownload)
const inspect = vi.mocked(commands.connectorInspectFile)
const install = vi.mocked(commands.connectorInstallFile)

const PACKAGE = {
  engine: 'redis',
  displayName: 'Redis',
  version: '0.2.0',
  publisher: 'Example Labs',
  isOfficial: false,
  sha256: 'ab12',
}

beforeEach(() => {
  vi.clearAllMocks()
  useEngineStore.setState({ engines: DEFAULT_ENGINES, error: null })
})

describe('the form model of a MongoDB connection', () => {
  test('keeps the auth source and the SRV option in the parameters', () => {
    const draft: ConnectionDraft = {
      ...withEngine(toDraft(makeProfile()), 'mongodb'),
      authSource: 'admin',
      isSrv: true,
      params: 'replicaSet=rs0',
    }

    const result = toProfile(draft)

    expect(result.ok && result.profile).toMatchObject({
      engine: 'mongodb',
      port: 27017,
      params: { replicaSet: 'rs0', authSource: 'admin', srv: 'true' },
    })
    const back = toDraft(result.ok ? result.profile : makeProfile())
    expect(back.authSource).toBe('admin')
    expect(back.isSrv).toBe(true)
    expect(back.params).toBe('replicaSet=rs0')
  })

  test('keeps a port that the user changed when the engine changes', () => {
    const draft = { ...toDraft(makeProfile()), port: '6000' }

    expect(withEngine(draft, 'mongodb').port).toBe('6000')
    expect(withEngine(toDraft(makeProfile()), 'mongodb').port).toBe('27017')
  })
})

describe('ConnectorDownloadDialog', () => {
  test('sends no request before Download, then shows the progress and the result', async () => {
    const user = userEvent.setup()
    let send: (event: DownloadEvent) => void = () => {}
    let finish: (value: unknown) => void = () => {}
    download.mockImplementation((_engine, channel) => {
      send = (event) => channel.onmessage(event)
      return new Promise((resolve) => {
        finish = resolve as (value: unknown) => void
      })
    })
    const onInstalled = vi.fn()
    render(
      <ConnectorDownloadDialog
        engine="mongodb"
        onInstalled={onInstalled}
        onClose={() => {}}
      />,
    )

    expect(screen.getByRole('dialog')).toHaveTextContent('tabloxide.org')
    expect(screen.getByRole('dialog')).toHaveTextContent('your permissions')
    expect(download).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Download' }))
    send({ type: 'downloading', version: '0.1.0', size: 2 * 1024 * 1024 })
    send({ type: 'progress', received: 1024 * 1024 })

    expect(await screen.findByText(/1.0 MB of 2.0 MB/)).toBeInTheDocument()
    finish({
      status: 'ok',
      data: {
        status: 'installed',
        package: { ...PACKAGE, engine: 'mongodb', isOfficial: true },
      },
    })
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(onInstalled).toHaveBeenCalled()
  })

  test('shows a failure and can try again', async () => {
    const user = userEvent.setup()
    download.mockResolvedValue({
      status: 'ok',
      data: { status: 'failed', message: 'The checksum does not agree.' },
    })
    render(
      <ConnectorDownloadDialog
        engine="mongodb"
        onInstalled={() => {}}
        onClose={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Download' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('checksum')
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(download).toHaveBeenCalledTimes(2))
  })
})

describe('InstallFromFile', () => {
  test('a package without the project signature needs a confirmation that names the risk', async () => {
    const user = userEvent.setup()
    inspect.mockResolvedValue({
      status: 'ok',
      data: { status: 'needs-confirmation', package: PACKAGE },
    })
    install.mockResolvedValue({
      status: 'ok',
      data: { status: 'installed', package: PACKAGE },
    })
    const onInstalled = vi.fn()
    render(<InstallFromFile onInstalled={onInstalled} onClose={() => {}} />)

    const dialog = await screen.findByRole('dialog', {
      name: /different source/,
    })
    expect(dialog).toHaveTextContent('Example Labs')
    expect(dialog).toHaveTextContent('passwords and the data')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(install).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Install' }))
    await user.click(await screen.findByRole('button', { name: 'Continue' }))

    expect(install).toHaveBeenCalledWith('/downloads/x.tar.gz', 'ab12', true)
    expect(onInstalled).toHaveBeenCalledWith('redis')
  })

  test('an official package installs without a question', async () => {
    inspect.mockResolvedValue({
      status: 'ok',
      data: { status: 'installed', package: { ...PACKAGE, isOfficial: true } },
    })
    install.mockResolvedValue({
      status: 'ok',
      data: { status: 'installed', package: { ...PACKAGE, isOfficial: true } },
    })
    render(<InstallFromFile onInstalled={() => {}} onClose={() => {}} />)

    expect(
      await screen.findByText(/connector 0.2.0 is installed/),
    ).toBeVisible()
    expect(install).toHaveBeenCalledWith('/downloads/x.tar.gz', 'ab12', false)
  })
})
