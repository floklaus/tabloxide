import {
  acceptCompletion,
  completionStatus,
  currentCompletions,
  startCompletion,
} from '@codemirror/autocomplete'
import { undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, test, vi } from 'vitest'
import {
  CodeEditor,
  type CodeEditorHandle,
  type CodeEditorProps,
  type EditorPreferences,
} from './CodeEditor'

const preferences: EditorPreferences = {
  font_size: 14,
  tab_width: 2,
  line_numbers: true,
  word_wrap: false,
}

function setup(
  initial: {
    tabId?: string
    value?: string
    completionSource?: CodeEditorProps['completionSource']
    onFormatError?: CodeEditorProps['onFormatError']
  } = {},
) {
  const ref = createRef<CodeEditorHandle>()
  const handlers = { onChange: vi.fn(), onRun: vi.fn(), onSave: vi.fn() }
  const props = {
    ref,
    tabId: initial.tabId ?? 't1',
    value: initial.value ?? 'select 1;\nselect 2',
    preferences,
    completionSource: initial.completionSource,
    onFormatError: initial.onFormatError,
    language: 'sql' as CodeEditorProps['language'],
    ...handlers,
  }
  const { container, rerender } = render(<CodeEditor {...props} />)
  const view = () => {
    const found = EditorView.findFromDOM(container.querySelector('.cm-editor')!)
    if (!found) throw new Error('The editor view is not in the document.')
    return found
  }
  const update = (change: Partial<CodeEditorProps>) =>
    rerender(<CodeEditor {...props} {...change} />)
  return { ref, handlers, view, update, container }
}

describe('CodeEditor', () => {
  test('changes the syntax and the label when the language of the tab changes', () => {
    const { update, container } = setup({ value: 'db.users.find({ a: 1 })' })
    const content = () => container.querySelector('.cm-content')

    expect(content()).toHaveAttribute('aria-label', 'SQL')
    update({ language: 'mongodb-shell' })

    expect(content()).toHaveAttribute('aria-label', 'MongoDB statements')
    // The JavaScript mode marks `users` and `find` as property names.
    expect(container.querySelector('.tok-propertyName')?.textContent).toBe(
      'users',
    )
  })

  test('shows the text with line numbers and SQL highlighting', () => {
    const { view, container } = setup()

    expect(view().state.doc.toString()).toBe('select 1;\nselect 2')
    expect(container.querySelector('.cm-lineNumbers')).not.toBeNull()
    expect(container.querySelector('.tok-keyword')?.textContent).toBe('select')
  })

  test('reports a change of the text', () => {
    const { view, handlers } = setup()

    view().dispatch({ changes: { from: 0, to: 6, insert: 'SELECT' } })

    expect(handlers.onChange).toHaveBeenCalledWith('SELECT 1;\nselect 2')
  })

  test('gives the cursor position or the selection as the run target', () => {
    const { view, ref } = setup()

    view().dispatch({ selection: { anchor: 12 } })
    expect(ref.current?.getTarget()).toEqual({ type: 'at', offset: 12 })

    view().dispatch({ selection: { anchor: 10, head: 18 } })
    expect(ref.current?.getTarget()).toEqual({
      type: 'range',
      from: 10,
      to: 18,
    })
  })

  test('moves the cursor to an offset', () => {
    const { view, ref } = setup()

    ref.current?.focusAt(10)

    expect(view().state.selection.main.head).toBe(10)
  })

  test('shows text that changes outside the editor', () => {
    const { view, update, handlers } = setup()

    update({ value: 'select 3' })

    expect(view().state.doc.toString()).toBe('select 3')
    expect(handlers.onChange).toHaveBeenCalledWith('select 3')
  })

  test('keeps the cursor of each tab', () => {
    const { view, update } = setup()
    view().dispatch({ selection: { anchor: 5 } })

    update({ tabId: 't2', value: 'other' })
    expect(view().state.doc.toString()).toBe('other')
    expect(view().state.selection.main.head).toBe(0)

    update({ tabId: 't1', value: 'select 1;\nselect 2' })
    expect(view().state.selection.main.head).toBe(5)
  })

  test('joins the completion of the database and the keywords of SQL', async () => {
    const completionSource = vi.fn(async (context: { pos: number }) => ({
      from: context.pos - 2,
      options: [{ label: 'item_name', type: 'property' }],
    }))
    const { view } = setup({ value: 'select it', completionSource })

    view().dispatch({ selection: { anchor: 9 } })
    startCompletion(view())
    await vi.waitFor(() =>
      expect(completionStatus(view().state)).toBe('active'),
    )
    const labels = currentCompletions(view().state).map(
      (option) => option.label,
    )
    // The editor accepts a completion only after a short delay after the list opened.
    await vi.waitFor(() => {
      acceptCompletion(view())
      expect(view().state.doc.toString()).toBe('select item_name')
    })

    expect(labels).toContain('item_name')
    expect(completionSource).toHaveBeenCalled()
  })

  test('formats all text, or only the selection, in one undo step', () => {
    const { view, ref } = setup({
      value: 'select a,b from t;\nselect c from u',
    })

    view().dispatch({ selection: { anchor: 19, head: 34 } })
    ref.current?.format()
    expect(view().state.doc.toString()).toBe(
      'select a,b from t;\nselect\n  c\nfrom\n  u',
    )

    undo(view())
    view().dispatch({ selection: { anchor: 0 } })
    ref.current?.format()
    expect(view().state.doc.toString()).toBe(
      'select\n  a,\n  b\nfrom\n  t;\n\nselect\n  c\nfrom\n  u',
    )
  })

  test('reports SQL that the formatter cannot read and keeps the text', () => {
    const onFormatError = vi.fn()
    const { view, ref } = setup({ value: "select 'open", onFormatError })

    ref.current?.format()

    expect(onFormatError).toHaveBeenCalledWith(
      expect.stringMatching(/^The formatter cannot read/),
    )
    expect(view().state.doc.toString()).toBe("select 'open")
  })

  test('applies the preferences', () => {
    const { container, update, view } = setup()

    update({
      preferences: {
        ...preferences,
        line_numbers: false,
        word_wrap: true,
        tab_width: 4,
      },
    })

    expect(container.querySelector('.cm-lineNumbers')).toBeNull()
    expect(container.querySelector('.cm-lineWrapping')).not.toBeNull()
    expect(view().state.tabSize).toBe(4)
  })

  test('shows a proposal of the AI without a change of the text', () => {
    const { ref, view, container, handlers } = setup({
      value: 'select 1;\nselect 2',
    })

    act(() => ref.current?.showProposal({ from: 10, to: 18, text: 'select 3' }))

    expect(view().state.doc.toString()).toBe('select 1;\nselect 2')
    expect(view().state.readOnly).toBe(true)
    expect(container.querySelector('.cm-ai-removed')).toHaveTextContent(
      'select 2',
    )
    expect(container.querySelector('.cm-ai-proposal')).toHaveTextContent(
      'select 3',
    )
    expect(handlers.onChange).not.toHaveBeenCalled()
  })

  test('an accepted proposal is one undo step, and a rejected one changes nothing', () => {
    const { ref, view, container } = setup({ value: 'select 1;\nselect 2' })

    act(() => ref.current?.showProposal({ from: 10, to: 18, text: 'select 3' }))
    act(() => ref.current?.applyProposal())

    expect(view().state.doc.toString()).toBe('select 1;\nselect 3')
    expect(view().state.readOnly).toBe(false)
    expect(container.querySelector('.cm-ai-proposal')).toBeNull()
    undo(view())
    expect(view().state.doc.toString()).toBe('select 1;\nselect 2')

    act(() => ref.current?.showProposal({ from: 0, to: 8, text: 'select 9' }))
    act(() => ref.current?.clearProposal())

    expect(view().state.doc.toString()).toBe('select 1;\nselect 2')
    expect(view().state.readOnly).toBe(false)
    expect(container.querySelector('.cm-ai-removed')).toBeNull()
  })

  test('the lock makes the editor read-only until it opens again', () => {
    const { ref, view } = setup()

    act(() => ref.current?.setLocked(true))
    expect(view().state.readOnly).toBe(true)
    act(() => ref.current?.clearProposal())

    expect(view().state.readOnly).toBe(false)
  })

  test('a tab that the user leaves during a proposal is not read-only', () => {
    const { ref, view, update } = setup({ tabId: 't1', value: 'select 1' })
    act(() => ref.current?.showProposal({ from: 0, to: 8, text: 'select 2' }))

    update({ tabId: 't2', value: 'select 5' })
    update({ tabId: 't1', value: 'select 1' })

    expect(view().state.readOnly).toBe(false)
    expect(view().state.doc.toString()).toBe('select 1')
  })

  test('Ctrl+I and Ctrl+Shift+I go to the AI functions, not to the default keys', () => {
    const onAiChange = vi.fn()
    const onAiExplain = vi.fn()
    const { view, update } = setup()
    update({ onAiChange, onAiExplain })
    const key = (shiftKey: boolean) =>
      view().contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: shiftKey ? 'I' : 'i',
          code: 'KeyI',
          keyCode: 73,
          ctrlKey: true,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      )

    key(false)
    key(true)

    expect(onAiChange).toHaveBeenCalledTimes(1)
    expect(onAiExplain).toHaveBeenCalledTimes(1)
  })

  test('during a proposal, Ctrl+Enter goes to the AI function and does not run', () => {
    const onAiKey = vi.fn(() => true)
    const { view, update, handlers } = setup()
    update({ onAiKey })

    view().contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        keyCode: 13,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )

    expect(onAiKey).toHaveBeenCalledWith('accept')
    expect(handlers.onRun).not.toHaveBeenCalled()
  })
})
