import { CompletionContext } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import {
  completeSnippets,
  getSnippets,
  invalidateSnippets,
  isValidSnippetName,
  parseSnippet,
  saveSnippet,
  snippetFileText,
  SNIPPET_FOLDER,
} from './snippets'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)

const fileList = vi.mocked(commands.fileList)
const fileRead = vi.mocked(commands.fileRead)
const fileWrite = vi.mocked(commands.fileWrite)

function context(doc: string, explicit = false) {
  return new CompletionContext(
    EditorState.create({ doc }),
    doc.length,
    explicit,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  invalidateSnippets()
  fileList.mockResolvedValue({
    status: 'ok',
    data: [
      {
        name: 'monthly.sql',
        path: `${SNIPPET_FOLDER}/monthly.sql`,
        is_directory: false,
      },
      {
        name: 'select.sql',
        path: `${SNIPPET_FOLDER}/select.sql`,
        is_directory: false,
      },
      {
        name: 'notes.txt',
        path: `${SNIPPET_FOLDER}/notes.txt`,
        is_directory: false,
      },
    ],
  })
  fileRead.mockImplementation(async (path) => ({
    status: 'ok',
    data: path.endsWith('monthly.sql')
      ? '-- Sales of one month\nSELECT * FROM sales WHERE month = ${month};\n'
      : 'SELECT 1;',
  }))
  fileWrite.mockResolvedValue({ status: 'ok', data: null })
})

describe('snippet files', () => {
  test('a first comment line is the description', () => {
    expect(parseSnippet('a', '-- Monthly sales\nselect ${month}\n\n')).toEqual({
      name: 'a',
      description: 'Monthly sales',
      template: 'select ${month}',
      isBuiltIn: false,
    })
    expect(parseSnippet('b', 'select 1').description).toBeNull()
  })

  test('writes the description as a comment', () => {
    expect(snippetFileText('Monthly sales', 'select 1\n\n')).toBe(
      '-- Monthly sales\nselect 1\n',
    )
    expect(snippetFileText(' ', 'select 1')).toBe('select 1\n')
  })

  test('accepts only simple names', () => {
    expect(isValidSnippetName('monthly sales-2')).toBe(true)
    for (const name of ['', '../x', 'a/b', '.hidden', 'a.', 'x'.repeat(65)]) {
      expect(isValidSnippetName(name)).toBe(false)
    }
  })
})

describe('getSnippets', () => {
  test('a snippet of the workspace replaces the built-in snippet with its name', async () => {
    const snippets = await getSnippets()

    const names = snippets.map((snippet) => snippet.name)
    expect(names.slice(0, 2)).toEqual(['monthly', 'select'])
    expect(names.filter((name) => name === 'select')).toHaveLength(1)
    expect(names).toContain('insert')
    expect(snippets[1].isBuiltIn).toBe(false)
    expect(fileRead).toHaveBeenCalledTimes(2)
  })

  test('gives the built-in snippets when the folder does not exist', async () => {
    fileList.mockResolvedValue({
      status: 'error',
      error: { kind: 'workspace', message: 'not found', issues: [] },
    })

    const snippets = await getSnippets()

    expect(snippets.every((snippet) => snippet.isBuiltIn)).toBe(true)
  })

  test('reads the folder one time until an invalidation', async () => {
    await getSnippets()
    await getSnippets()
    invalidateSnippets()
    await getSnippets()

    expect(fileList).toHaveBeenCalledTimes(2)
  })
})

describe('saveSnippet', () => {
  test('writes the file in the snippet folder and reads the folder again', async () => {
    await getSnippets()

    const message = await saveSnippet('top customers', 'The best', 'select 1')
    await getSnippets()

    expect(message).toBeNull()
    expect(fileWrite).toHaveBeenCalledWith(
      `${SNIPPET_FOLDER}/top customers.sql`,
      '-- The best\nselect 1\n',
    )
    expect(fileList).toHaveBeenCalledTimes(2)
  })

  test('refuses a name that is a path', async () => {
    const message = await saveSnippet('../escape', '', 'select 1')

    expect(message).toMatch(/Use letters/)
    expect(fileWrite).not.toHaveBeenCalled()
  })
})

describe('completeSnippets', () => {
  test('offers the snippets for a word', async () => {
    const result = await completeSnippets(context('mon'))

    expect(result?.from).toBe(0)
    expect(result?.options[0]).toMatchObject({
      label: 'monthly',
      detail: 'workspace snippet',
      info: 'Sales of one month',
    })
  })

  test('offers no snippet after a dot or without a word', async () => {
    expect(await completeSnippets(context('select o.mon'))).toBeNull()
    expect(await completeSnippets(context('select '))).toBeNull()
    expect(await completeSnippets(context('select ', true))).not.toBeNull()
  })
})
