import type { ColumnKind } from '../../bindings'

const PATHS: Record<ColumnKind, string> = {
  number: 'M9 4L7 20M17 4l-2 16M4 9h17M3 15h17',
  temporal: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 0 0 0-17M12 7.5V12l3 2',
  text: 'M5 6h14M12 6v13',
  boolean: 'M4 5h16v14H4zM8 12l3 3l5-6',
  json: 'M9 4c-3 0-3 2-3 4s0 4-2 4c2 0 2 2 2 4s0 4 3 4M15 4c3 0 3 2 3 4s0 4 2 4c-2 0-2 2-2 4s0 4-3 4',
  other: 'M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7',
}

/** The icon of the kind of a column: number, date, text, and so on. */
export function KindIcon({ kind }: { kind: ColumnKind }) {
  return (
    <svg
      className="chart__kind"
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
    >
      <path
        d={PATHS[kind]}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The icon of "Number of rows", which is not a column. */
export function RowsIcon() {
  return (
    <svg
      className="chart__kind"
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
    >
      <path
        d="M4 6h16M4 12h16M4 18h16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function WarningIcon() {
  return (
    <svg
      className="chart__warning-icon"
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
    >
      <path
        d="M12 4L2.5 20h19zM12 10v5M12 17.5v.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
