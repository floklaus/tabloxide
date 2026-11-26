import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands, type GitRemoteEvent } from '../bindings'
import { useTabsStore } from '../tabs/tabsStore'
import { failed, ok, repository } from '../test/gitFixtures'
import { CredentialDialog } from './CredentialDialog'
import { GitPanel } from './GitPanel'
import { useGitStore } from './gitStore'
import { useRemoteStore } from './remoteStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

const gitPull = vi.mocked(commands.gitPull)
const gitCredentialAnswer = vi.mocked(commands.gitCredentialAnswer)

type PullResult = Awaited<ReturnType<typeof commands.gitPull>>

/**
 * Makes the pull stay in progress. Returns a function that sends an event of Git
 * to the UI and a function that ends the pull.
 */
function pendingPull() {
  let finish: (result: PullResult) => void = () => {}
  let send: (event: GitRemoteEvent) => void = () => {}
  gitPull.mockImplementation((channel) => {
    send = (event) => channel.onmessage(event)
    return new Promise<PullResult>((resolve) => {
      finish = resolve
    })
  })
  return {
    send: (event: GitRemoteEvent) => send(event),
    finish: (result: PullResult) => finish(result),
  }
}

async function startPull() {
  vi.mocked(commands.gitOverview).mockResolvedValue(ok(repository()))
  render(
    <>
      <GitPanel />
      <CredentialDialog />
    </>,
  )
  await waitFor(() => expect(useGitStore.getState().overview).not.toBeNull())
  const user = userEvent.setup()
  const pull = pendingPull()
  await user.click(screen.getByRole('button', { name: 'More git actions' }))
  await user.click(screen.getByRole('menuitem', { name: /^Pull/ }))
  return { user, pull }
}

const PASSWORD_PROMPT = "Password for 'https://ada@example.com':"

beforeEach(() => {
  vi.clearAllMocks()
  useGitStore.getState().reset()
  useTabsStore.getState().reset()
  useRemoteStore.getState().end()
})

describe('remote operations', () => {
  test('shows the last progress line and clears it at the end', async () => {
    const { pull } = await startPull()

    pull.send({ type: 'progress', line: 'Receiving objects:  10% (1/10)' })
    pull.send({ type: 'progress', line: 'Receiving objects:  90% (9/10)' })

    const status = await screen.findByText(/Receiving objects: 90%/)
    expect(status).toBeInTheDocument()
    expect(screen.queryByText(/10% \(1\/10\)/)).not.toBeInTheDocument()

    pull.finish(ok('Already up to date.'))
    await waitFor(() => expect(useGitStore.getState().busy).toBeNull())
    expect(useRemoteStore.getState().progress).toBeNull()
  })

  test('asks for a password, hides it, and sends it to Git', async () => {
    const { user, pull } = await startPull()

    pull.send({
      type: 'credential',
      id: 7,
      prompt: PASSWORD_PROMPT,
      is_secret: true,
    })
    const field = await screen.findByLabelText(PASSWORD_PROMPT)
    expect(field).toHaveAttribute('type', 'password')
    await user.type(field, 's3cr3t')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(gitCredentialAnswer).toHaveBeenCalledWith(7, 's3cr3t')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // No store keeps the answer.
    expect(JSON.stringify(useRemoteStore.getState())).not.toContain('s3cr3t')
    expect(JSON.stringify(useGitStore.getState())).not.toContain('s3cr3t')
  })

  test('shows a user name as plain text', async () => {
    const { pull } = await startPull()

    pull.send({
      type: 'credential',
      id: 1,
      prompt: "Username for 'https://example.com':",
      is_secret: false,
    })

    expect(
      await screen.findByLabelText("Username for 'https://example.com':"),
    ).toHaveAttribute('type', 'text')
  })

  test('asks the questions one after the other with an empty field', async () => {
    const { user, pull } = await startPull()
    pull.send({ type: 'credential', id: 1, prompt: 'First:', is_secret: false })
    pull.send({ type: 'credential', id: 2, prompt: 'Second:', is_secret: true })

    await user.type(await screen.findByLabelText('First:'), 'ada')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByLabelText('Second:')).toHaveValue('')
    expect(gitCredentialAnswer).toHaveBeenCalledWith(1, 'ada')
  })

  test('a cancel sends no answer, and the panel shows the error of Git', async () => {
    const { user, pull } = await startPull()
    pull.send({
      type: 'credential',
      id: 3,
      prompt: PASSWORD_PROMPT,
      is_secret: true,
    })

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(gitCredentialAnswer).toHaveBeenCalledWith(3, null)
    pull.finish(failed('fatal: could not read Password'))

    expect(
      await screen.findByText(/could not read Password/),
    ).toBeInTheDocument()
  })

  test('closes a question when the operation ends without an answer', async () => {
    const { pull } = await startPull()
    pull.send({
      type: 'credential',
      id: 4,
      prompt: PASSWORD_PROMPT,
      is_secret: true,
    })
    await screen.findByRole('dialog')

    pull.finish(failed('fatal: timeout'))

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })
})
