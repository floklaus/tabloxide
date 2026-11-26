import { useEffect, useState } from 'react'

/** Empty: the view has nothing to show yet. One sentence, and one button that fixes it. */
export function EmptyState({
  text,
  action,
}: {
  text: string
  action?: { label: string; run: () => void }
}) {
  return (
    <div className="view-state">
      <p>{text}</p>
      {action && (
        <button
          type="button"
          className="button button--small"
          onClick={action.run}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

/** Empty: the filter hides all rows. It shows the filter text and clears the filter. */
export function NoMatch({
  noun,
  filter,
  onClear,
}: {
  /** The plural of the objects, for example "tables". */
  noun: string
  filter: string
  onClear: () => void
}) {
  return (
    <div className="view-state">
      <p>
        No {noun} contain “{filter}”.
      </p>
      <button type="button" className="button button--small" onClick={onClear}>
        Clear the filter
      </button>
    </div>
  )
}

/** The time before the skeleton rows show. A fast read shows no skeleton. */
export const SKELETON_DELAY_MS = 300

/**
 * Loading: after 300 ms, skeleton rows at the row height. The text goes to the
 * status line and to a screen reader.
 */
export function Loading({ text, rows = 4 }: { text: string; rows?: number }) {
  const [isLate, setIsLate] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setIsLate(true), SKELETON_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div role="status" aria-label={text}>
      {isLate &&
        Array.from({ length: rows }, (_, index) => (
          <div key={index} className="view-skeleton" aria-hidden="true">
            <span style={{ width: 16 }} />
            <span style={{ width: `${40 + ((index * 23) % 45)}%` }} />
          </div>
        ))}
    </div>
  )
}

/**
 * Error: at the top of the body. It says what failed and what to do, and has
 * "Try again". It stays until the person acts.
 */
export function ViewError({
  title,
  detail,
  onRetry,
}: {
  title: string
  detail?: string | null
  onRetry?: () => void
}) {
  return (
    <div className="view-state view-state--error" role="alert">
      <p>{title}</p>
      {detail && <p className="view-state__detail">{detail}</p>}
      {onRetry && (
        <button
          type="button"
          className="button button--small"
          onClick={onRetry}
        >
          Try again
        </button>
      )}
    </div>
  )
}
