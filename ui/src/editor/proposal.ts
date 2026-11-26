import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view'

/**
 * A change of the AI that the editor shows before the user accepts it. The text of
 * the document does not change until the user accepts. Thus a proposal is not in
 * the undo history, and a reject changes nothing.
 */
export type Proposal = { from: number; to: number; text: string }

const setProposal = StateEffect.define<Proposal | null>({
  map: (value, mapping) =>
    value && {
      ...value,
      from: mapping.mapPos(value.from, 1),
      to: mapping.mapPos(value.to, -1),
    },
})

/** The proposed text, as a block below the text that it replaces. */
class ProposalWidget extends WidgetType {
  readonly text: string

  constructor(text: string) {
    super()
    this.text = text
  }

  eq(other: ProposalWidget): boolean {
    return other.text === this.text
  }

  toDOM(): HTMLElement {
    const block = document.createElement('div')
    block.className = 'cm-ai-proposal'
    block.setAttribute('aria-label', 'Proposed text')
    for (const line of this.text.split('\n')) {
      const row = document.createElement('div')
      row.className = 'cm-ai-proposal__line'
      row.textContent = line || '​'
      block.append(row)
    }
    return block
  }
}

const removed = Decoration.mark({ class: 'cm-ai-removed' })

const proposalField = StateField.define<Proposal | null>({
  create: () => null,
  update(value, transaction) {
    let next = value && {
      ...value,
      from: transaction.changes.mapPos(value.from, 1),
      to: transaction.changes.mapPos(value.to, -1),
    }
    for (const effect of transaction.effects) {
      if (effect.is(setProposal)) next = effect.value
    }
    return next
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value): DecorationSet => {
      if (!value) return Decoration.none
      const ranges = []
      if (value.to > value.from) {
        ranges.push(removed.range(value.from, value.to))
      }
      ranges.push(
        Decoration.widget({
          widget: new ProposalWidget(value.text),
          block: true,
          side: 1,
        }).range(value.to),
      )
      return Decoration.set(ranges)
    }),
})

/** The lock that makes the editor read-only while an AI change is in progress. */
const lockCompartment = new Compartment()

/** The extensions of the AI change. Each editor state needs them. */
export function proposalExtensions(): Extension {
  return [proposalField, lockCompartment.of([])]
}

/** `true` if the state shows a proposal. */
export function hasProposal(state: EditorState): boolean {
  return state.field(proposalField, false) != null
}

/** Makes the editor read-only, or makes it editable again. */
export function setLocked(view: EditorView, locked: boolean): void {
  view.dispatch({
    effects: lockCompartment.reconfigure(
      locked ? EditorState.readOnly.of(true) : [],
    ),
  })
}

/** Shows `proposal` in the editor. The editor is read-only while it shows. */
export function showProposal(view: EditorView, proposal: Proposal): void {
  const length = view.state.doc.length
  const from = Math.min(proposal.from, length)
  const to = Math.min(Math.max(proposal.to, from), length)
  view.dispatch({
    effects: [
      setProposal.of({ ...proposal, from, to }),
      lockCompartment.reconfigure(EditorState.readOnly.of(true)),
    ],
    scrollIntoView: true,
  })
}

/** Removes the proposal and the lock. The text does not change. */
export function clearProposal(view: EditorView): void {
  view.dispatch({
    effects: [setProposal.of(null), lockCompartment.reconfigure([])],
  })
}

/**
 * Puts the proposed text into the document and selects it. The undo history keeps
 * the change as one step. Returns `false` if the editor shows no proposal.
 */
export function applyProposal(view: EditorView): boolean {
  const proposal = view.state.field(proposalField, false)
  if (!proposal) return false
  clearProposal(view)
  view.dispatch({
    changes: { from: proposal.from, to: proposal.to, insert: proposal.text },
    selection: {
      anchor: proposal.from,
      head: proposal.from + proposal.text.length,
    },
    scrollIntoView: true,
    userEvent: 'input.replace',
  })
  view.focus()
  return true
}

/**
 * Returns `state` without a proposal and without the lock. A tab that the user
 * leaves keeps this state, so that it does not stay read-only.
 */
export function withoutProposal(state: EditorState): EditorState {
  return state.update({
    effects: [setProposal.of(null), lockCompartment.reconfigure([])],
  }).state
}
