/** The line icons of the shell. The paths come from the design in `.design/imported/`. */
const PATHS = {
  files: 'M6 3h8l4 4v14H6z M14 3v4h4',
  connections:
    'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  schema: 'M4 5h16v14H4z M4 10h16 M10 10v9',
  git: 'M6 3v12 M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M18 9c0 5-12 2-12 6',
  history: 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 7v5l3 2',
  assistant: 'M4 5h16v11H9l-5 4z M8 9h8 M8 12h5',
  sessions: 'M3 4h13v9H7l-4 3z M8 16v1h9l4 3V8h-2',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
  chevron: 'M6 9l6 6 6-6',
  folder: 'M3 6h6l2 2h10v11H3z',
  play: 'M7 5l12 7-12 7z',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
  plus: 'M12 5v14 M5 12h14',
  close: 'M6 6l12 12 M18 6L6 18',
  grip: 'M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className="icon"
    >
      <path
        d={PATHS[name]}
        stroke="currentColor"
        strokeWidth="1.75"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The logo: a table with one cell in the accent colour. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <span className={`logo ${size > 24 ? 'logo--large' : ''}`.trim()}>
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24">
        <rect
          x="2.75"
          y="2.75"
          width="18.5"
          height="18.5"
          rx="3.5"
          className="logo__frame"
          strokeWidth="1.5"
        />
        <path
          d="M2.75 6.25a3.5 3.5 0 0 1 3.5-3.5h11.5a3.5 3.5 0 0 1 3.5 3.5V8.5H2.75z"
          className="logo__head"
        />
        <path
          d="M2.75 14.5h18.5M9 8.5v12.75M15 8.5v12.75"
          className="logo__lines"
          strokeWidth="1.5"
          fill="none"
        />
        <rect
          x="9.75"
          y="9.25"
          width="4.5"
          height="4.5"
          className="logo__cell"
        />
      </svg>
      <span className="logo__name">
        Tabl<span className="logo__accent">oxide</span>
      </span>
    </span>
  )
}
