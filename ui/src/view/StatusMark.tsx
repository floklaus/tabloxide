import type { ReactNode } from 'react'

/** The states of the one status scale of all views (view standards, part 1). */
export type Status = 'ok' | 'busy' | 'neutral' | 'warning' | 'error'

/**
 * The shape of each state. The shape stays in each theme, so a person who does not
 * see the colour can see the state: a filled circle, an open arc, a ring, a
 * triangle, and a diamond.
 */
const SHAPES: Record<Status, ReactNode> = {
  ok: <circle cx="8" cy="8" r="5" fill="currentColor" />,
  busy: (
    <path
      d="M8 3a5 5 0 1 1-5 5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  ),
  neutral: (
    <circle
      cx="8"
      cy="8"
      r="4.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    />
  ),
  warning: <path d="M8 2.5l6 10.5H2z" fill="currentColor" />,
  error: <path d="M8 2l6 6-6 6-6-6z" fill="currentColor" />,
}

/**
 * The status mark of a row. `label` is the state for a screen reader, for example
 * "Connected". Put the mark before the label of the row.
 */
export function StatusMark({
  status,
  label,
}: {
  status: Status
  label: string
}) {
  return (
    <span className={`status-mark status-mark--${status}`}>
      <svg
        role="img"
        aria-label={label}
        width="16"
        height="16"
        viewBox="0 0 16 16"
      >
        <title>{label}</title>
        {SHAPES[status]}
      </svg>
    </span>
  )
}
