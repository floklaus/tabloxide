import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { commands } from '../bindings'

/** The folder of the snippets in the workspace. Git can track it. */
export const SNIPPET_FOLDER = '.tabloxide/snippets'

/** A snippet has a name of letters, digits, spaces, and `_`, `-`, `.`. */
const SNIPPET_NAME = /^[\w][\w .-]{0,63}$/

export type Snippet = {
  name: string
  /** The first line of the file, if it is a comment. */
  description: string | null
  /**
   * The text. `${name}` marks a field that the user fills in. Tab moves to the
   * next field.
   */
  template: string
  isBuiltIn: boolean
}

const BUILT_IN: Snippet[] = [
  {
    name: 'select',
    description: 'Read rows of a table',
    template:
      'SELECT ${columns}\nFROM ${table}\nWHERE ${condition}\nLIMIT ${100};',
  },
  {
    name: 'join',
    description: 'Read rows of two tables',
    template:
      'SELECT ${columns}\nFROM ${first} AS a\nJOIN ${second} AS b ON b.${id} = a.${id};',
  },
  {
    name: 'with',
    description: 'A common table expression',
    template: 'WITH ${name} AS (\n  ${query}\n)\nSELECT *\nFROM ${name};',
  },
  {
    name: 'insert',
    description: 'Add a row',
    template: 'INSERT INTO ${table} (${columns})\nVALUES (${values});',
  },
  {
    name: 'update',
    description: 'Change rows',
    template: 'UPDATE ${table}\nSET ${column} = ${value}\nWHERE ${condition};',
  },
  {
    name: 'delete',
    description: 'Delete rows',
    template: 'DELETE FROM ${table}\nWHERE ${condition};',
  },
].map((snippet) => ({ ...snippet, isBuiltIn: true }))

/** Returns `true` if `name` is a valid name for a snippet file. */
export function isValidSnippetName(name: string): boolean {
  return SNIPPET_NAME.test(name) && !name.endsWith('.')
}

/** Reads a snippet file. A first line that is a comment is the description. */
export function parseSnippet(name: string, text: string): Snippet {
  const [first, ...rest] = text.split('\n')
  const isComment = first.startsWith('--')
  return {
    name,
    description: isComment ? first.replace(/^--\s*/, '').trim() || null : null,
    template: (isComment ? rest.join('\n') : text).replace(/\s+$/, ''),
    isBuiltIn: false,
  }
}

/** Writes the text of a snippet file. */
export function snippetFileText(description: string, template: string): string {
  const comment = description.trim() ? `-- ${description.trim()}\n` : ''
  return `${comment}${template.replace(/\s+$/, '')}\n`
}

export function snippetPath(name: string): string {
  return `${SNIPPET_FOLDER}/${name}.sql`
}

async function readWorkspaceSnippets(): Promise<Snippet[]> {
  try {
    const list = await commands.fileList(SNIPPET_FOLDER)
    // The folder does not exist until the user saves the first snippet.
    if (list.status !== 'ok') return []
    const files = list.data.filter(
      (entry) => !entry.is_directory && entry.name.endsWith('.sql'),
    )
    const snippets = await Promise.all(
      files.map(async (file) => {
        const text = await commands.fileRead(file.path)
        return text.status === 'ok'
          ? parseSnippet(file.name.slice(0, -'.sql'.length), text.data)
          : null
      }),
    )
    return snippets.filter((snippet) => snippet !== null)
  } catch {
    return []
  }
}

let loaded: Promise<Snippet[]> | null = null

/**
 * Returns the snippets of the workspace and the built-in snippets. A snippet of the
 * workspace replaces a built-in snippet with the same name.
 */
export function getSnippets(): Promise<Snippet[]> {
  loaded ??= readWorkspaceSnippets().then((own) => {
    const names = new Set(own.map((snippet) => snippet.name))
    return [...own, ...BUILT_IN.filter((snippet) => !names.has(snippet.name))]
  })
  return loaded
}

/** Forgets the snippets, for example after a change of the snippet folder. */
export function invalidateSnippets(): void {
  loaded = null
}

/** Saves the snippet `name` in the workspace. Returns a message on failure. */
export async function saveSnippet(
  name: string,
  description: string,
  template: string,
): Promise<string | null> {
  if (!isValidSnippetName(name)) {
    return 'Use letters, digits, spaces, and the characters _ - . in the name.'
  }
  const result = await commands.fileWrite(
    snippetPath(name),
    snippetFileText(description, template),
  )
  invalidateSnippets()
  return result.status === 'ok' ? null : result.error.message
}

function toCompletion(snippet: Snippet): Completion {
  return snippetCompletion(snippet.template, {
    label: snippet.name,
    type: 'text',
    detail: snippet.isBuiltIn ? 'snippet' : 'workspace snippet',
    info: snippet.description ?? undefined,
    boost: -1,
  })
}

/** The completion source of the snippets. It completes a word at the start of a statement part. */
export async function completeSnippets(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const word = context.matchBefore(/[\w-]+$/)
  if (!word && !context.explicit) return null
  // A word after a dot is a column or a table. A snippet does not fit there.
  const from = word?.from ?? context.pos
  if (context.state.sliceDoc(from - 1, from) === '.') return null
  const snippets = await getSnippets()
  if (context.aborted || snippets.length === 0) return null
  return { from, options: snippets.map(toCompletion), validFor: /^[\w-]*$/ }
}
