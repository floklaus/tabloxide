import { create } from 'zustand'
import { commands } from '../bindings'
import { activeEditor } from '../editor/editorBridge'
import { connectionLanguage } from '../engines/engineStore'
import { toMessage } from '../lib/errors'
import { useShellStore } from '../shell/shellStore'
import { sqlTabForTools, type Tab } from '../tabs/tabsStore'
import { onlyCodeBlock } from './answerSegments'
import { createSession, type SessionStore } from './assistantSession'
import { runAiAction, useAssistantStore } from './assistantStore'

/** The text that an AI action of the editor uses. */
export type EditorText = { tab: Tab; from: number; to: number; text: string }

/**
 * Returns the selection of the editor. Without a selection, it returns the
 * statement at the cursor. Returns `null` if there is no text.
 */
export async function selectionOrStatement(): Promise<EditorText | null> {
  const tab = sqlTabForTools()
  const editor = activeEditor()
  if (!tab || !editor) return null
  const target = editor.getTarget()
  if (target.type === 'range') {
    const { from, to } = target
    return { tab, from, to, text: tab.content.slice(from, to) }
  }
  const previews = await commands.queryPreview(
    tab.content,
    target,
    connectionLanguage(tab.connectionId),
  )
  const first = previews[0]
  const last = previews[previews.length - 1]
  if (!first || !last) return null
  const { from } = first.range
  const { to } = last.range
  const text = tab.content.slice(from, to)
  return text.trim() ? { tab, from, to, text } : null
}

/** Opens the assistant panel. Without an API key, the panel shows the setup. */
function showSetup(): void {
  const shell = useShellStore.getState()
  if (!shell.panels.assistant) shell.togglePanel('assistant')
}

/** Ctrl+Shift+I: explains the selection, or the statement at the cursor, in the panel. */
export async function explainSelection(): Promise<void> {
  const target = await selectionOrStatement()
  if (!target) return
  await runAiAction({
    task: 'explain-selection',
    text: 'Explain the selected text.',
    context: { type: 'selection', text: target.text },
  })
}

export type InlinePhase = 'closed' | 'instruction' | 'waiting' | 'preview'

const NO_TEXT =
  'Select the text to change, or put the cursor in a statement. Then press Ctrl+I.'

const NOT_ONE_BLOCK =
  'The AI did not give exactly one changed text. Change the instruction, and send it again.'

type InlineState = {
  phase: InlinePhase
  /** The tab of the change. The change closes when the user selects a different tab. */
  tabId: string | null
  from: number
  to: number
  /** The text that the change replaces. */
  original: string
  instruction: string
  /** The changed text of the AI. */
  proposal: string | null
  /** What the last request sent, for example "Sent: your request." */
  sent: string | null
  error: string | null

  /** Ctrl+I: opens the instruction field for the selection or the statement. */
  start: () => Promise<void>
  setInstruction: (instruction: string) => void
  /** Sends the instruction. The editor is read-only until the answer comes. */
  submit: () => Promise<void>
  /** Puts the proposal into the editor. */
  accept: () => void
  /** Removes the proposal. The text does not change. */
  reject: () => void
  /** Removes the proposal and asks for a new instruction in the same conversation. */
  changeAgain: () => void
  /** Stops a request in progress, or closes the change. */
  close: () => void
}

const CLOSED = {
  phase: 'closed' as InlinePhase,
  tabId: null,
  from: 0,
  to: 0,
  original: '',
  instruction: '',
  proposal: null,
  sent: null,
  error: null,
}

/** The conversation of the change. It is not in the list of the panel. */
let session: SessionStore | null = null
/** Each request has a number. An answer of an old request does nothing. */
let requestNumber = 0

export const useInlineChange = create<InlineState>((set, get) => {
  const unlock = () => activeEditor()?.clearProposal()

  return {
    ...CLOSED,

    start: async () => {
      if (get().phase !== 'closed') return
      if (useAssistantStore.getState().hasKey === false) {
        showSetup()
        return
      }
      try {
        const target = await selectionOrStatement()
        if (!target) {
          const tab = sqlTabForTools()
          if (tab) {
            set({
              ...CLOSED,
              phase: 'instruction',
              tabId: tab.id,
              error: NO_TEXT,
            })
          }
          return
        }
        session = createSession()
        // The editor is read-only until the change closes. An edit would move the
        // text that the change replaces.
        activeEditor()?.setLocked(true)
        set({
          ...CLOSED,
          phase: 'instruction',
          tabId: target.tab.id,
          from: target.from,
          to: target.to,
          original: target.text,
        })
      } catch (error) {
        set({ error: toMessage(error) })
      }
    },

    setInstruction: (instruction) => set({ instruction }),

    submit: async () => {
      const { phase, instruction, original } = get()
      const text = instruction.trim()
      if (phase !== 'instruction' || !text || !original || !session) return
      const number = ++requestNumber
      const current = session
      const isFirst = current.getState().messages.length === 0
      set({ phase: 'waiting', error: null })
      await current.getState().runAction({
        task: 'change-selection',
        text,
        // The first message has the text. A later message of the same conversation
        // changes the same text, thus it does not send the text again.
        ...(isFirst
          ? { context: { type: 'selection' as const, text: original } }
          : {}),
      })
      if (number !== requestNumber || get().phase !== 'waiting') return
      const state = current.getState()
      const answer = state.messages[state.messages.length - 1]
      const request = state.messages[state.messages.length - 2]
      const proposal =
        answer?.role === 'assistant' ? onlyCodeBlock(answer.text) : null
      if (state.error || proposal === null) {
        set({ phase: 'instruction', error: state.error ?? NOT_ONE_BLOCK })
        return
      }
      const { from, to } = get()
      activeEditor()?.showProposal({ from, to, text: proposal })
      set({
        phase: 'preview',
        proposal,
        sent: request?.sent ?? null,
        instruction: '',
      })
    },

    accept: () => {
      if (get().phase !== 'preview') return
      activeEditor()?.applyProposal()
      session = null
      set(CLOSED)
    },

    reject: () => {
      if (get().phase !== 'preview') return
      unlock()
      session = null
      set(CLOSED)
    },

    changeAgain: () => {
      if (get().phase !== 'preview') return
      unlock()
      activeEditor()?.setLocked(true)
      set({ phase: 'instruction', proposal: null, error: null })
    },

    close: () => {
      if (get().phase === 'closed') return
      requestNumber++
      if (get().phase === 'waiting') void session?.getState().stop()
      unlock()
      session = null
      set(CLOSED)
    },
  }
})

/**
 * Handles Ctrl+Enter and Escape of the editor during a change. Returns `true` if
 * the key was for the change.
 */
export function inlineChangeKey(key: 'accept' | 'escape'): boolean {
  const state = useInlineChange.getState()
  if (state.phase === 'closed') return false
  if (key === 'accept') {
    if (state.phase !== 'preview') return state.phase === 'waiting'
    state.accept()
    return true
  }
  if (state.phase === 'preview') state.reject()
  else state.close()
  return true
}
