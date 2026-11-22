import { useImperativeHandle, useRef, type KeyboardEvent } from 'react'
import type { RunTarget } from '../bindings'
import type { CodeEditorProps } from '../editor/CodeEditor'

function targetOf(input: HTMLTextAreaElement | null): RunTarget {
  if (!input) return { type: 'all' }
  const { selectionStart: from, selectionEnd: to } = input
  return from === to
    ? { type: 'at', offset: from }
    : { type: 'range', from, to }
}

/**
 * A text area with the interface of the code editor. jsdom has no layout, thus tests
 * of the components around the editor use this replacement.
 */
export function CodeEditor(props: CodeEditorProps) {
  const { ref, value, onChange, onRun, onSave } = props
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(ref, () => ({
    getTarget: () => targetOf(inputRef.current),
    focusAt: (offset) => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(offset, offset)
    },
    format: () => {},
    getSelectedText: () => {
      const input = inputRef.current
      if (!input || input.selectionStart === input.selectionEnd) return value
      return value.slice(input.selectionStart, input.selectionEnd)
    },
    insertText: (text) => {
      const input = inputRef.current
      if (!input) return
      const { selectionStart: from, selectionEnd: to } = input
      onChange(value.slice(0, from) + text + value.slice(to))
      input.focus()
    },
  }))

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return
    if (event.key === 'Enter') {
      onRun(event.shiftKey ? { type: 'all' } : targetOf(inputRef.current))
    } else if (event.key === 's') {
      onSave()
    }
  }

  return (
    <textarea
      ref={inputRef}
      aria-label="SQL"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
  )
}
