import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { useTabsStore, type Tab } from '../tabs/tabsStore'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { AssistantPanel } from './AssistantPanel'
import { activeSession, useAssistantStore } from './assistantStore'
import { fitsLanguage } from './codeLanguage'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)

const tab: Tab = {
  id: 'tab-1',
  title: 'Query 1',
  path: null,
  content: '',
  savedContent: null,
  connectionId: 'c1',
}

function showAnswer(engine: string, answer: string) {
  useWorkspaceStore.setState({
    workspace: makeWorkspace([makeProfile({ id: 'c1', name: 'Shop', engine })]),
  })
  useTabsStore.setState({
    tabs: [tab],
    activeId: tab.id,
    sqlId: tab.id,
    isLoaded: true,
    error: null,
  })
  activeSession().setState({
    title: 'Find users',
    messages: [
      { role: 'user', text: 'Find users.' },
      { role: 'assistant', text: answer },
    ],
  })
  render(<AssistantPanel />)
}

describe('the language of a code block', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAssistantStore.getState().reset()
    useAssistantStore.setState({ hasKey: true })
    vi.mocked(commands.assistantStatus).mockResolvedValue({
      status: 'ok',
      data: { has_key: true },
    })
  })

  test('each language accepts its tags, and a block without a tag', () => {
    expect(fitsLanguage('sql', 'sql')).toBe(true)
    expect(fitsLanguage('PostgreSQL', 'sql')).toBe(true)
    expect(fitsLanguage('mongodb', 'sql')).toBe(false)
    expect(fitsLanguage('sh', 'sql')).toBe(false)
    expect(fitsLanguage('mongodb', 'mongodb-shell')).toBe(true)
    expect(fitsLanguage('javascript', 'mongodb-shell')).toBe(true)
    expect(fitsLanguage('sql', 'mongodb-shell')).toBe(false)
    expect(fitsLanguage('', 'mongodb-shell')).toBe(true)
    expect(fitsLanguage('cypher', 'unknown')).toBe(true)
  })

  test('a block of a different language has Copy and no Insert', async () => {
    showAnswer(
      'mongodb',
      'Two forms.\n\n```mongodb\ndb.users.find()\n```\n\n```sql\nselect * from users\n```',
    )

    const [mongo, sql] = await screen.findAllByText(/db\.users|select \*/)
    const mongoBlock = mongo.closest('.assistant__block') as HTMLElement
    const sqlBlock = sql.closest('.assistant__block') as HTMLElement
    expect(
      within(mongoBlock).getByRole('button', { name: 'Insert' }),
    ).toBeInTheDocument()
    expect(
      within(sqlBlock).queryByRole('button', { name: 'Insert' }),
    ).not.toBeInTheDocument()
    expect(within(sqlBlock).getByRole('button', { name: 'Copy' })).toBeVisible()
    expect(sqlBlock).toHaveTextContent('not in the language of the tab')
  })

  test('a language without a guide gets a note in the panel', async () => {
    showAnswer('neo4j', '```text\nMATCH (n) RETURN n\n```')

    expect(
      await screen.findByText(/no guide of the AI for the query language/),
    ).toBeInTheDocument()
  })

  test('a known language gets no note', async () => {
    showAnswer('postgres', '```sql\nselect 1\n```')

    await screen.findByText('select 1')
    expect(
      screen.queryByText(/no guide of the AI for the query language/),
    ).not.toBeInTheDocument()
  })
})
