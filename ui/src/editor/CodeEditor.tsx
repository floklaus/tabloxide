import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import { PostgreSQL, sql } from '@codemirror/lang-sql'
import {
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState, type Extension } from '@codemirror/state'
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
import type { EditorPreferences_Serialize, RunTarget } from '../bindings'

export type EditorPreferences = EditorPreferences_Serialize

export type CodeEditorHandle = {
  /** The selection, or the cursor position if there is no selection. */
  getTarget: () => RunTarget
  /** Moves the cursor to `offset` and gives the focus to the editor. */
  focusAt: (offset: number) => void
  /** Replaces the selection with `text` and gives the focus to the editor. */
  insertText: (text: string) => void
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
}

type Callbacks = Pick<CodeEditorProps, 'onChange' | 'onRun' | 'onSave'>

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

function makeState(
  doc: string,
  preferences: EditorPreferences,
  callbacks: { current: Callbacks },
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
      sql({ dialect: PostgreSQL }),
      syntaxHighlighting(classHighlighter),
      preferenceExtensions(preferences),
      keymap.of([
        { key: 'Mod-Enter', run: run(targetOf) },
        { key: 'Shift-Mod-Enter', run: run(() => ({ type: 'all' })) },
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            callbacks.current.onSave()
            return true
          },
        },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          callbacks.current.onChange(update.state.doc.toString())
        }
      }),
      EditorView.contentAttributes.of({ 'aria-label': 'SQL' }),
    ],
  })
}

/** The SQL editor. One editor shows the text of the active tab. */
export function CodeEditor(props: CodeEditorProps) {
  const { ref, tabId, value, preferences } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const statesRef = useRef(new Map<string, EditorState>())
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
    } else if (shown.tabId !== tabId) {
      states.set(shown.tabId, view.state)
    }
    if (shown?.tabId !== tabId || shown.preferences !== preferences) {
      view.setState(
        states.get(tabId) ?? makeState(value, preferences, callbacks),
      )
      shownRef.current = { tabId, preferences }
    }
    // The text can change outside the editor, for example when a file loads.
    if (view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      })
    }
  }, [tabId, value, preferences])

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
