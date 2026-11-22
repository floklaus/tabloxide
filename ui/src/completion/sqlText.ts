/**
 * A small reader of SQL text for the completion. It finds the tables of a statement
 * and the name before the cursor. It does not check the syntax.
 */

type Token =
  | { kind: 'word'; text: string; start: number }
  | { kind: 'quoted'; text: string; start: number }
  | { kind: 'symbol'; text: string; start: number }

/** A table that a statement names, with its alias. */
export type TableReference = {
  schema: string | null
  name: string
  alias: string | null
}

/** The name before the cursor. */
export type CompletionTarget = {
  /** The names before the last dot, for example `["public", "item"]`. */
  qualifier: string[]
  /** The text of the last name that the user typed. It can be empty. */
  prefix: string
  /** The offset of the prefix in the text. */
  from: number
}

/** Keywords that can follow a table name. They are not an alias. */
const NOT_AN_ALIAS = new Set([
  'where',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'outer',
  'cross',
  'natural',
  'on',
  'using',
  'group',
  'order',
  'having',
  'limit',
  'offset',
  'fetch',
  'for',
  'window',
  'union',
  'intersect',
  'except',
  'returning',
  'set',
  'values',
  'select',
  'lateral',
  'tablesample',
  'default',
  'as',
])

/** Keywords that come before a table name. */
const TABLE_KEYWORDS = new Set(['from', 'join', 'update', 'into', 'table'])

const WORD = /[A-Za-z_][\w$]*/y
const DOLLAR_TAG = /\$([A-Za-z_]\w*)?\$/y

/** The end of a string or a comment that does not end in the text. */
const OPEN = Number.POSITIVE_INFINITY

/**
 * Returns the end of a string, a comment, or a dollar quote at `start`. Returns `OPEN`
 * if it does not end in the text, and -1 if no string or comment starts at `start`.
 */
function skipEnd(sql: string, start: number): number {
  const char = sql[start]
  const next = sql[start + 1]
  if (char === '-' && next === '-') {
    const end = sql.indexOf('\n', start)
    return end === -1 ? OPEN : end + 1
  }
  if (char === '/' && next === '*') {
    const end = sql.indexOf('*/', start + 2)
    return end === -1 ? OPEN : end + 2
  }
  if (char === "'") {
    let index = start + 1
    while (index < sql.length) {
      if (sql[index] === "'" && sql[index + 1] === "'") index += 2
      else if (sql[index] === "'") return index + 1
      else index += 1
    }
    return OPEN
  }
  if (char === '$') {
    DOLLAR_TAG.lastIndex = start
    const tag = DOLLAR_TAG.exec(sql)
    if (!tag) return -1
    const end = sql.indexOf(tag[0], start + tag[0].length)
    return end === -1 ? OPEN : end + tag[0].length
  }
  return -1
}

/** Splits SQL text into words, quoted identifiers, and symbols. */
export function tokenize(sql: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < sql.length) {
    const char = sql[index]
    const skipped = skipEnd(sql, index)
    if (skipped !== -1) {
      index = skipped
    } else if (/\s/.test(char)) {
      index += 1
    } else if (char === '"') {
      let end = index + 1
      let text = ''
      while (end < sql.length) {
        if (sql[end] === '"' && sql[end + 1] === '"') {
          text += '"'
          end += 2
        } else if (sql[end] === '"') {
          break
        } else {
          text += sql[end]
          end += 1
        }
      }
      tokens.push({ kind: 'quoted', text, start: index })
      index = end + 1
    } else {
      WORD.lastIndex = index
      const word = WORD.exec(sql)
      if (word) {
        tokens.push({ kind: 'word', text: word[0], start: index })
        index += word[0].length
      } else {
        tokens.push({ kind: 'symbol', text: char, start: index })
        index += 1
      }
    }
  }
  return tokens
}

const isName = (token: Token | undefined): boolean =>
  token?.kind === 'word' || token?.kind === 'quoted'

/** An unquoted name is not case-sensitive. The completion compares it in lower case. */
function nameOf(token: Token): string {
  return token.kind === 'word' ? token.text.toLowerCase() : token.text
}

/** Reads a dotted name at `index`. Returns the parts and the index after the name. */
function dottedName(tokens: Token[], index: number) {
  const parts: string[] = []
  let position = index
  while (isName(tokens[position])) {
    parts.push(nameOf(tokens[position]))
    if (tokens[position + 1]?.text !== '.') return { parts, next: position + 1 }
    position += 2
  }
  return { parts, next: position }
}

/** Reads one table reference with its optional alias. */
function reference(tokens: Token[], index: number) {
  const { parts, next } = dottedName(tokens, index)
  // A function call (for example `read_csv('a.csv')`) is not a table of the catalog.
  if (parts.length === 0 || parts.length > 3 || tokens[next]?.text === '(') {
    return { table: null, next }
  }
  let position = next
  if (
    tokens[position]?.kind === 'word' &&
    tokens[position].text.toLowerCase() === 'as'
  ) {
    position += 1
  }
  const candidate = tokens[position]
  const hasAlias =
    isName(candidate) &&
    !(
      candidate.kind === 'word' &&
      NOT_AN_ALIAS.has(candidate.text.toLowerCase())
    )
  const name = parts[parts.length - 1]
  const schema = parts.length >= 2 ? parts[parts.length - 2] : null
  return {
    table: { schema, name, alias: hasAlias ? nameOf(candidate) : null },
    next: hasAlias ? position + 1 : position,
  }
}

/** Returns the tables that `statement` names after FROM, JOIN, UPDATE, INTO, and TABLE. */
export function tableReferences(statement: string): TableReference[] {
  const tokens = tokenize(statement)
  const tables: TableReference[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (
      token.kind !== 'word' ||
      !TABLE_KEYWORDS.has(token.text.toLowerCase())
    ) {
      continue
    }
    let position = index + 1
    // A FROM list can name more than one table, separated by commas.
    for (;;) {
      const { table, next } = reference(tokens, position)
      if (table) tables.push(table)
      if (tokens[next]?.text !== ',' || token.text.toLowerCase() !== 'from')
        break
      position = next + 1
    }
  }
  return tables
}

const TARGET =
  /((?:(?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*)\.){0,2})("(?:[^"]|"")*|[A-Za-z_][\w$]*)?$/

/** Splits the qualifier text `a."B".` into its names. */
function qualifierParts(text: string): string[] {
  return tokenize(text)
    .filter((token) => token.kind !== 'symbol')
    .map(nameOf)
}

/** Returns the name before the end of `textBefore`, or `null` in a string or a comment. */
export function completionTarget(textBefore: string): CompletionTarget | null {
  if (isInStringOrComment(textBefore)) return null
  const match = TARGET.exec(textBefore)
  if (!match) return null
  const [whole, qualifier, prefix = ''] = match
  return {
    qualifier: qualifierParts(qualifier),
    prefix: prefix.startsWith('"') ? prefix.slice(1) : prefix,
    from: textBefore.length - whole.length + qualifier.length,
  }
}

/** Returns `true` if the end of `text` is in a string, a comment, or a dollar quote. */
function isInStringOrComment(text: string): boolean {
  let index = 0
  while (index < text.length) {
    const skipped = skipEnd(text, index)
    if (skipped === OPEN) return true
    index = skipped === -1 ? index + 1 : skipped
  }
  return false
}

/** Returns the statement around `offset`. Statements end with a semicolon. */
export function statementAround(
  text: string,
  offset: number,
): { statement: string; start: number } {
  let start = 0
  let index = 0
  while (index < text.length) {
    const skipped = skipEnd(text, index)
    if (skipped !== -1) {
      index = skipped
      continue
    }
    if (text[index] === ';') {
      if (index >= offset) return { statement: text.slice(start, index), start }
      start = index + 1
    }
    index += 1
  }
  return { statement: text.slice(start), start }
}

/** Puts a name in double quotes if SQL does not read it as the same name without them. */
export function quoteIfNecessary(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name)
    ? name
    : `"${name.replace(/"/g, '""')}"`
}
