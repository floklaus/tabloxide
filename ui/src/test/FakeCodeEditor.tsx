import { useImperativeHandle, useRef, type KeyboardEvent } from 'react'
import type { RunTarget } from '../bindings'
import type { CodeEditorProps } from '../editor/CodeEditor'
import type { Proposal } from '../editor/proposal'

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
  const proposalRef = useRef<Proposal | null>(null)
  const clear = () => {
    proposalRef.current = null
    if (inputRef.current) {
      inputRef.current.readOnly = false
      delete inputRef.current.dataset.proposal
    }
  }

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
    replaceRange: (from, to, text) => {
      onChange(value.slice(0, from) + text + value.slice(to))
      inputRef.current?.focus()
    },
    setLocked: (locked) => {
      if (inputRef.current) inputRef.current.readOnly = locked
    },
    showProposal: (proposal) => {
      proposalRef.current = proposal
      if (inputRef.current) {
        inputRef.current.readOnly = true
        inputRef.current.dataset.proposal = proposal.text
      }
    },
    applyProposal: () => {
      const proposal = proposalRef.current
      if (!proposal) return
      onChange(
        value.slice(0, proposal.from) +
          proposal.text +
          value.slice(proposal.to),
      )
      clear()
    },
    clearProposal: () => clear(),
  }))

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && props.onAiKey?.('escape')) {
      event.preventDefault()
      return
    }
    if (!(event.ctrlKey || event.metaKey)) return
    if (event.code === 'KeyI') {
      event.preventDefault()
      if (event.shiftKey) props.onAiExplain?.()
      else props.onAiChange?.()
    } else if (event.key === 'Enter') {
      if (props.onAiKey?.('accept')) return
      onRun(event.shiftKey ? { type: 'all' } : targetOf(inputRef.current))
    } else if (event.key === 's') {
      onSave()
    }
  }

  return (
    <textarea
      ref={inputRef}
      aria-label={
        props.language === 'mongodb-shell' ? 'MongoDB statements' : 'SQL'
      }
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
  )
}
