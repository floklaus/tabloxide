import { EditorView } from '@codemirror/view'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, test, vi } from 'vitest'
import {
  CodeEditor,
  type CodeEditorHandle,
  type EditorPreferences,
} from './CodeEditor'

const preferences: EditorPreferences = {
  font_size: 14,
  tab_width: 2,
  line_numbers: true,
  word_wrap: false,
}

function setup(initial: { tabId?: string; value?: string } = {}) {
  const ref = createRef<CodeEditorHandle>()
  const handlers = { onChange: vi.fn(), onRun: vi.fn(), onSave: vi.fn() }
  const props = {
    ref,
    tabId: initial.tabId ?? 't1',
    value: initial.value ?? 'select 1;\nselect 2',
    preferences,
    ...handlers,
  }
  const { container, rerender } = render(<CodeEditor {...props} />)
  const view = () => {
    const found = EditorView.findFromDOM(container.querySelector('.cm-editor')!)
    if (!found) throw new Error('The editor view is not in the document.')
    return found
  }
  const update = (change: Partial<typeof props>) =>
    rerender(<CodeEditor {...props} {...change} />)
  return { ref, handlers, view, update, container }
}

describe('CodeEditor', () => {
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
})
