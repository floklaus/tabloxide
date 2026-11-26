import { MergeView } from '@codemirror/merge'
import { useEffect, useRef, useState } from 'react'
import { AiAction } from '../assistant/AiAction'
import { onlyCodeBlock, splitAnswer } from '../assistant/answerSegments'
import type { SessionStore } from '../assistant/assistantStore'
import {
  commands,
  type ConflictSides_Serialize as ConflictSides,
} from '../bindings'
import { DIFF_BASE, readOnlySide, sideLabel } from './diffExtensions'
import { useLoad } from './gitLoad'
import { useGitStore } from './gitStore'

type TwoSidesProps = {
  path: string
  ours: string
  theirs: string
}

/**
 * A conflict where the two branches changed the file. The left side is the incoming
 * version. The right side is the result, which the user can edit.
 */
function TwoSides({ path, ours, theirs }: TwoSidesProps) {
  const busy = useGitStore((state) => state.busy)
  const resolveWithText = useGitStore((state) => state.resolveWithText)
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<MergeView | null>(null)
  /** The result that the AI proposes, or a note if the answer has none. */
  const [proposal, setProposal] = useState<
    { text: string; explanation: string[] } | { note: string } | null
  >(null)

  const receive = (session: SessionStore) => {
    const { messages, error } = session.getState()
    const answer = messages[messages.length - 1]
    if (error || answer?.role !== 'assistant') return
    const text = onlyCodeBlock(answer.text)
    setProposal(
      text === null
        ? {
            note: 'The answer has no result that the application can use. Read it in the assistant panel.',
          }
        : {
            text,
            // The text outside the code block explains the proposal.
            explanation: splitAnswer(answer.text).flatMap((segment) =>
              segment.type === 'text' ? [segment.text] : [],
            ),
          },
    )
  }

  useEffect(() => {
    const view = new MergeView({
      parent: hostRef.current ?? undefined,
      a: {
        doc: theirs,
        extensions: readOnlySide(`Incoming version of ${path}`),
      },
      b: {
        doc: ours,
        extensions: [...DIFF_BASE, sideLabel(`Result for ${path}`)],
      },
      // Each changed block gets a button that copies the incoming block into the result.
      revertControls: 'a-to-b',
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [ours, theirs, path])

  const setResult = (text: string) => {
    const result = viewRef.current?.b
    if (!result) return
    result.dispatch({
      changes: { from: 0, to: result.state.doc.length, insert: text },
    })
  }
  const resolve = () => {
    const result = viewRef.current?.b
    if (result) void resolveWithText(path, result.state.doc.toString())
  }
  const accept = (text: string, edit: boolean) => {
    setResult(text)
    setProposal(null)
    if (edit) viewRef.current?.b.focus()
  }

  return (
    <>
      <p className="results__status">
        Left: the incoming version. Right: the result, which starts as your
        version. Edit the result, or copy blocks from the left side with the
        arrow buttons.
      </p>
      <div className="git__row">
        <button
          type="button"
          className="button button--small"
          onClick={() => setResult(ours)}
        >
          Use my version
        </button>
        <button
          type="button"
          className="button button--small"
          onClick={() => setResult(theirs)}
        >
          Use the incoming version
        </button>
        <AiAction
          label="Propose a resolution"
          title="The AI proposes a result that keeps the changes of the two branches. The request sends the three versions of this file."
          request={() => ({
            task: 'conflict',
            text: `Propose a resolution of the conflict in ${path}.`,
            context: { type: 'conflict', path },
          })}
          after={receive}
        />
        <button
          type="button"
          className="button button--small button--primary"
          disabled={busy !== null}
          onClick={resolve}
        >
          Mark as resolved
        </button>
      </div>
      {proposal && 'note' in proposal && (
        <p className="message" role="status">
          {proposal.note}
        </p>
      )}
      {proposal && 'text' in proposal && (
        <section
          className="conflict__proposal"
          aria-labelledby="conflict-proposal-title"
        >
          <h4 id="conflict-proposal-title" className="conflict__proposal-title">
            Proposed resolution
          </h4>
          {proposal.explanation.map((paragraph, index) => (
            <p key={index} className="conflict__explanation">
              {paragraph}
            </p>
          ))}
          <pre className="conflict__kept">{proposal.text}</pre>
          <div className="git__row">
            <button
              type="button"
              className="button button--small button--primary"
              onClick={() => accept(proposal.text, false)}
            >
              Accept
            </button>
            <button
              type="button"
              className="button button--small"
              onClick={() => accept(proposal.text, true)}
            >
              Edit in the result
            </button>
            <button
              type="button"
              className="button button--small"
              onClick={() => setProposal(null)}
            >
              Reject
            </button>
          </div>
          <p className="results__status">
            The request sent the three versions of this file to Anthropic.
            Accept puts the text into the result. You still mark the file as
            resolved.
          </p>
        </section>
      )}
      <div ref={hostRef} className="diff__sides code-editor" />
    </>
  )
}

/** A conflict where one branch deleted the file and the other branch changed it. */
function OneSide({ path, sides }: { path: string; sides: ConflictSides }) {
  const busy = useGitStore((state) => state.busy)
  const resolveWithText = useGitStore((state) => state.resolveWithText)
  const resolveByDelete = useGitStore((state) => state.resolveByDelete)
  const kept = sides.ours ?? sides.theirs
  const explanation =
    sides.ours === null
      ? 'Your branch deleted this file. The incoming branch changed it.'
      : 'The incoming branch deleted this file. Your branch changed it.'

  return (
    <>
      <p className="results__status">
        {kept === null ? 'The two branches deleted this file.' : explanation}
      </p>
      <div className="git__row">
        {kept !== null && (
          <button
            type="button"
            className="button button--small"
            disabled={busy !== null}
            onClick={() => void resolveWithText(path, kept)}
          >
            Keep the changed file
          </button>
        )}
        <button
          type="button"
          className="button button--small button--danger"
          disabled={busy !== null}
          onClick={() => void resolveByDelete(path)}
        >
          Delete the file
        </button>
      </div>
      {kept !== null && <pre className="conflict__kept">{kept}</pre>}
    </>
  )
}

/**
 * The detail tab of a file with a conflict, for its resolution. It reads the versions
 * only once, so a new read of the status does not remove the edits of the user.
 */
export function ConflictView({ path }: { path: string }) {
  const load = useLoad(path, () => commands.gitConflict(path))
  const sides = load.status === 'loaded' ? load.data : null

  return (
    <div className="diff">
      <h3 className="table-detail__title">Conflict in {path}</h3>
      {load.status === 'loading' && <p role="status">Loading the conflict…</p>}
      {load.status === 'failed' && (
        <p className="message message--error" role="alert">
          {load.message}
        </p>
      )}
      {sides && sides.ours !== null && sides.theirs !== null && (
        <TwoSides path={path} ours={sides.ours} theirs={sides.theirs} />
      )}
      {sides && (sides.ours === null || sides.theirs === null) && (
        <OneSide path={path} sides={sides} />
      )}
    </div>
  )
}
