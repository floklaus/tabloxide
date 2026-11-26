import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  commands,
  type ConfirmRule,
  type Environment,
  type Risk,
} from '../bindings'
import {
  DEFAULT_PREFERENCES,
  usePreferencesStore,
} from '../preferences/preferencesStore'
import { useTabsStore } from '../tabs/tabsStore'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { getQueryStore, resetQueryStores } from './queryStore'
import { requestRun, useRunConfirmStore } from './runConfirm'
import { RunConfirmDialog } from './RunConfirmDialog'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))

const queryPreview = vi.mocked(commands.queryPreview)
const queryRun = vi.mocked(commands.queryRun)
const SQL = 'select 1; drop table item'

function preview(risk: Risk | null, from = 0, to = 8) {
  return { range: { from, to }, risk }
}

function setRule(environment: Environment, rule: ConfirmRule) {
  usePreferencesStore.setState({
    preferences: {
      ...DEFAULT_PREFERENCES,
      guardrails: { ...DEFAULT_PREFERENCES.guardrails, [environment]: rule },
    },
  })
}

function setup(environment: Environment = 'development') {
  useWorkspaceStore.setState({
    workspace: makeWorkspace([
      makeProfile({ id: 'c1', name: 'Live', environment }),
    ]),
  })
  const tabId = useTabsStore.getState().newTab(SQL)
  useTabsStore.getState().setConnection(tabId, 'c1')
  getQueryStore(tabId).setState({
    session: { id: 7, connectionId: 'c1', version: '17' },
  })
  queryRun.mockResolvedValue({
    status: 'ok',
    data: { statements: [], open_result: null },
  })
  render(<RunConfirmDialog />)
  return userEvent.setup()
}

describe('requestRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueryStores()
    useTabsStore.getState().reset()
    useRunConfirmStore.setState({ pending: null })
    usePreferencesStore.setState({ preferences: DEFAULT_PREFERENCES })
  })

  test('runs immediately when no statement is destructive', async () => {
    setup()
    queryPreview.mockResolvedValue([preview(null)])

    await requestRun(SQL, { type: 'all' })

    expect(queryPreview).toHaveBeenCalledWith(SQL, { type: 'all' }, 'sql')
    expect(queryRun).toHaveBeenCalledWith(7, SQL, { type: 'all' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('checks the statements in the language of the engine of the connection', async () => {
    setup()
    useWorkspaceStore.setState({
      workspace: makeWorkspace([
        makeProfile({ id: 'c1', name: 'Docs', engine: 'mongodb' }),
      ]),
    })
    queryPreview.mockResolvedValue([preview(null)])

    await requestRun('db.users.find()', { type: 'all' })

    expect(queryPreview).toHaveBeenCalledWith(
      'db.users.find()',
      { type: 'all' },
      'mongodb-shell',
    )
  })

  test('asks before a statement that the application cannot check', async () => {
    setup()
    queryPreview.mockResolvedValue([preview('unchecked')])

    await requestRun(SQL, { type: 'all' })

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'The application cannot check this statement',
    )
    expect(queryRun).not.toHaveBeenCalled()
  })

  test('asks before a destructive statement, and runs after the confirmation', async () => {
    const user = setup()
    queryPreview.mockResolvedValue([preview(null), preview('drop', 10, 25)])

    await requestRun(SQL, { type: 'all' })

    const dialog = await screen.findByRole('dialog', {
      name: 'Run the statements?',
    })
    expect(dialog).toHaveTextContent('drop table item')
    expect(dialog).toHaveTextContent('DROP removes an object')
    expect(dialog).not.toHaveTextContent('production connection')
    expect(queryRun).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Run' }))

    expect(queryRun).toHaveBeenCalledWith(7, SQL, { type: 'all' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('does not run when the user cancels', async () => {
    const user = setup()
    queryPreview.mockResolvedValue([preview('truncate')])

    await requestRun(SQL, { type: 'all' })
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(queryRun).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('asks before each run on a production connection', async () => {
    setup('production')
    queryPreview.mockResolvedValue([preview(null)])

    await requestRun(SQL, { type: 'all' })

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Live is a production connection.',
    )
    expect(queryRun).not.toHaveBeenCalled()
  })

  test('does not ask when the rule of the environment is "never"', async () => {
    setup('production')
    setRule('production', 'never')
    queryPreview.mockResolvedValue([preview('drop')])

    await requestRun(SQL, { type: 'all' })

    expect(queryPreview).not.toHaveBeenCalled()
    await waitFor(() => expect(queryRun).toHaveBeenCalled())
  })

  test('asks only before a risky statement when the rule is "risky"', async () => {
    setup('production')
    setRule('production', 'risky')
    queryPreview.mockResolvedValue([preview(null)])

    await requestRun(SQL, { type: 'all' })

    expect(queryRun).toHaveBeenCalled()
  })

  test('asks before each run on a development connection when its rule is "always"', async () => {
    setup('development')
    setRule('development', 'always')
    queryPreview.mockResolvedValue([preview(null)])

    await requestRun(SQL, { type: 'all' })

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Live is a development connection.',
    )
    expect(queryRun).not.toHaveBeenCalled()
  })

  test('uses the rule of the environment of the connection', async () => {
    setup('staging')
    setRule('production', 'never')
    queryPreview.mockResolvedValue([preview('truncate')])

    await requestRun(SQL, { type: 'all' })

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'TRUNCATE removes all rows',
    )
    expect(queryRun).not.toHaveBeenCalled()
  })

  test('does not run when the preview fails', async () => {
    setup()
    queryPreview.mockRejectedValue(new Error('no backend'))

    await requestRun(SQL, { type: 'all' })

    expect(queryRun).not.toHaveBeenCalled()
  })
})
