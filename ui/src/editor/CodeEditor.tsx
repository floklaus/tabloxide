import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript'
import { PostgreSQL, sql } from '@codemirror/lang-sql'
import {
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { classHighlighter } from '@lezer/highlight'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type {
  EditorPreferences_Serialize,
  Engine,
  QueryLanguage_Serialize,
  RunTarget,
} from '../bindings'
import { formatSql } from './formatSql'

export type EditorPreferences = EditorPreferences_Serialize

export type CodeEditorHandle = {
  /** The selection, or the cursor position if there is no selection. */
  getTarget: () => RunTarget
  /** Moves the cursor to `offset` and gives the focus to the editor. */
  focusAt: (offset: number) => void
  /** Replaces the selection with `text` and gives the focus to the editor. */
  insertText: (text: string) => void
  /** Formats the selection, or all text if there is no selection. */
  format: () => void
  /** The selection, or all text if there is no selection. */
  getSelectedText: () => string
}

export type CodeEditorProps = {
  ref?: Ref<CodeEditorHandle>
  /** Each tab keeps its own undo history and cursor position. */
  tabId: string
  value: string
  preferences: EditorPreferences
  onChange: (value: string) => void
  onRun: (target: RunTarget) => void
  onSave: () => void
  /** Receives the line and the column of the cursor, from 1, after each move. */
  onCursorChange?: (cursor: { line: number; column: number }) => void
  /** The database engine whose SQL syntax the formatter uses. */
  engine?: Engine
  /** The query language of the tab. It selects the syntax highlighting. */
  language?: QueryLanguage_Serialize
  /** Receives the message when the formatter cannot read the SQL. */
  onFormatError?: (message: string) => void
  /** Gives completion options for the database of the tab. The keywords come from SQL. */
  completionSource?: (
    context: CompletionContext,
  ) => Promise<CompletionResult | null>
}

type Callbacks = Pick<
  CodeEditorProps,
  | 'onChange'
  | 'onRun'
  | 'onSave'
  | 'completionSource'
  | 'engine'
  | 'onFormatError'
  | 'onCursorChange'
>

/** The selection, or all text if there is no selection. */
function selectedRange(state: EditorState): { from: number; to: number } {
  const { from, to } = state.selection.main
  return from === to ? { from: 0, to: state.doc.length } : { from, to }
}

/** Formats the selection, or all text. One undo step restores the text. */
function formatIn(view: EditorView, callbacks: Callbacks): boolean {
  const { from, to } = selectedRange(view.state)
  const result = formatSql(
    view.state.sliceDoc(from, to),
    callbacks.engine ?? 'postgres',
    view.state.tabSize,
  )
  if (!result.ok) {
    callbacks.onFormatError?.(result.message)
    return true
  }
  view.dispatch({
    changes: { from, to, insert: result.text },
    selection: { anchor: from, head: from + result.text.length },
    scrollIntoView: true,
    userEvent: 'input.format',
  })
  return true
}

function targetOf(state: EditorState): RunTarget {
  const { from, to } = state.selection.main
  return from === to
    ? { type: 'at', offset: from }
    : { type: 'range', from, to }
}

function preferenceExtensions(preferences: EditorPreferences): Extension[] {
  return [
    EditorState.tabSize.of(preferences.tab_width),
    indentUnit.of(' '.repeat(preferences.tab_width)),
    EditorView.theme({ '&': { fontSize: `${preferences.font_size}px` } }),
    preferences.line_numbers
      ? [lineNumbers(), highlightActiveLineGutter()]
      : [],
    preferences.word_wrap ? EditorView.lineWrapping : [],
  ]
}

/** The syntax and the completion of the query language. Each tab can have its own. */
const languageCompartment = new Compartment()

function languageExtensions(
  language: QueryLanguage_Serialize,
  callbacks: { current: Callbacks },
): Extension {
  const autocomplete = (context: CompletionContext) =>
    callbacks.current.completionSource?.(context) ?? null
  switch (language) {
    case 'sql':
      return [
        EditorView.contentAttributes.of({ 'aria-label': 'SQL' }),
        sql({ dialect: PostgreSQL }),
        // The completion of the database joins the keyword completion of the language.
        PostgreSQL.language.data.of({ autocomplete }),
      ]
    case 'mongodb-shell':
      // The MongoDB statements are JavaScript calls. The application runs no JavaScript.
      return [
        EditorView.contentAttributes.of({ 'aria-label': 'MongoDB statements' }),
        javascript(),
        javascriptLanguage.data.of({ autocomplete }),
      ]
    default:
      return [EditorView.contentAttributes.of({ 'aria-label': 'Statements' })]
  }
}

function makeState(
  doc: string,
  preferences: EditorPreferences,
  callbacks: { current: Callbacks },
  language: QueryLanguage_Serialize,
): EditorState {
  const run =
    (target: (state: EditorState) => RunTarget) => (view: EditorView) => {
      callbacks.current.onRun(target(view.state))
      return true
    }
  return EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      languageCompartment.of(languageExtensions(language, callbacks)),
      autocompletion({ icons: false }),
      syntaxHighlighting(classHighlighter),
      preferenceExtensions(preferences),
      keymap.of([
        { key: 'Mod-Enter', run: run(targetOf) },
        { key: 'Shift-Mod-Enter', run: run(() => ({ type: 'all' })) },
        {
          key: 'Shift-Alt-f',
          run: (view) => formatIn(view, callbacks.current),
        },
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            callbacks.current.onSave()
            return true
          },
        },
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          callbacks.current.onChange(update.state.doc.toString())
        }
        if (update.docChanged || update.selectionSet) {
          const head = update.state.selection.main.head
          const line = update.state.doc.lineAt(head)
          callbacks.current.onCursorChange?.({
            line: line.number,
            column: head - line.from + 1,
          })
        }
      }),
    ],
  })
}

/** The SQL editor. One editor shows the text of the active tab. */
export function CodeEditor(props: CodeEditorProps) {
  const { ref, tabId, value, preferences } = props
  const language = props.language ?? 'sql'
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const statesRef = useRef(new Map<string, EditorState>())
  /** The language that the stored state of each tab has. */
  const languagesRef = useRef(new Map<string, QueryLanguage_Serialize>())
  const shownRef = useRef<{
    tabId: string
    preferences: EditorPreferences
  } | null>(null)
  const callbacks = useRef<Callbacks>(props)
  useEffect(() => {
    callbacks.current = props
  })

  useEffect(() => {
    const view = new EditorView({ parent: hostRef.current ?? undefined })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
      shownRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const shown = shownRef.current
    const states = statesRef.current
    if (shown?.preferences !== preferences) {
      // New preferences need new editor states. The undo history starts again.
      states.clear()
      languagesRef.current.clear()
    } else if (shown.tabId !== tabId) {
      states.set(shown.tabId, view.state)
    }
    if (shown?.tabId !== tabId || shown.preferences !== preferences) {
      view.setState(
        states.get(tabId) ?? makeState(value, preferences, callbacks, language),
      )
      shownRef.current = { tabId, preferences }
    }
    // The text can change outside the editor, for example when a file loads.
    if (view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      })
    }
    // A tab can change its connection, and with it its language.
    const languages = languagesRef.current
    if (!languages.has(tabId)) {
      languages.set(tabId, language)
    } else if (languages.get(tabId) !== language) {
      view.dispatch({
        effects: languageCompartment.reconfigure(
          languageExtensions(language, callbacks),
        ),
      })
      languages.set(tabId, language)
    }
  }, [tabId, value, preferences, language])

  useImperativeHandle(ref, () => ({
    getTarget: () =>
      viewRef.current ? targetOf(viewRef.current.state) : { type: 'all' },
    focusAt: (offset) => {
      const view = viewRef.current
      if (!view) return
      const position = Math.min(offset, view.state.doc.length)
      view.dispatch({ selection: { anchor: position }, scrollIntoView: true })
      view.focus()
    },
    format: () => {
      const view = viewRef.current
      if (!view) return
      formatIn(view, callbacks.current)
      view.focus()
    },
    getSelectedText: () => {
      const view = viewRef.current
      if (!view) return ''
      const { from, to } = selectedRange(view.state)
      return view.state.sliceDoc(from, to)
    },
    insertText: (text) => {
      const view = viewRef.current
      if (!view) return
      view.dispatch({
        ...view.state.replaceSelection(text),
        scrollIntoView: true,
        userEvent: 'input.paste',
      })
      view.focus()
    },
  }))

  return <div ref={hostRef} className="code-editor" />
}
