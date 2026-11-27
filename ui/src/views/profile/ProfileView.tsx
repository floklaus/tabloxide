import { useMemo } from 'react'
import { KIND_LABELS } from '../chart/columnKinds'
import { KindIcon } from '../chart/KindIcon'
import type { ViewProps } from '../viewTypes'
import {
  profileColumns,
  type ColumnProfile,
  type ProfileBar,
} from './profileData'

const numberFormat = new Intl.NumberFormat('en-US')
const percentFormat = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
})

function rowsText(value: number): string {
  return value === 1 ? '1 row' : `${numberFormat.format(value)} rows`
}

/**
 * Says which part of the result the profile shows. A profile must never look
 * complete when it is not. Returns `null` for a complete result.
 */
function partText(props: ViewProps): string | null {
  const { rows, hasMore, isComplete, totalRows } = props
  if (totalRows !== null && totalRows > rows.length) {
    return `Profile of the first ${numberFormat.format(rows.length)} of ${rowsText(totalRows)}.`
  }
  if (hasMore || !isComplete) {
    return `Profile of the first ${rowsText(rows.length)}. The result has more rows. Scroll in the Grid view to load more rows.`
  }
  return null
}

/** The distribution of a column as small bars. A screen reader gets the same numbers as text. */
function Bars({ profile }: { profile: ColumnProfile }) {
  const { bars, barsKind } = profile
  if (bars.length === 0) return null
  // A list of values that each occur one time tells nothing.
  const isAllDifferent = profile.distinct === profile.filled
  if (barsKind === 'top' && isAllDifferent && profile.filled > 1) return null
  const largest = Math.max(...bars.map((bar) => bar.count))
  const text = (bar: ProfileBar) => `${bar.label}: ${rowsText(bar.count)}`
  if (barsKind === 'histogram') {
    return (
      <div
        className="profile__histogram"
        role="img"
        aria-label={`Histogram. ${bars.map(text).join('. ')}.`}
      >
        {bars.map((bar, index) => (
          <span
            key={index}
            title={text(bar)}
            style={{ height: `${(bar.count / largest) * 100}%` }}
          />
        ))}
      </div>
    )
  }
  return (
    <ol className="profile__top" aria-label="Most frequent values">
      {bars.map((bar, index) => (
        <li key={index}>
          <span className="profile__top-label">{bar.label}</span>
          <span className="profile__top-count">
            {numberFormat.format(bar.count)}
          </span>
          <span
            className="profile__top-bar"
            aria-hidden="true"
            style={{ width: `${(bar.count / largest) * 100}%` }}
          />
        </li>
      ))}
    </ol>
  )
}

function ProfileRow({
  profile,
  rows,
}: {
  profile: ColumnProfile
  rows: number
}) {
  const { column } = profile
  return (
    <tr>
      <th scope="row">
        <span className="profile__name">
          <KindIcon kind={column.kind} />
          {column.name}
        </span>
        <span className="profile__type">
          {column.type_name ?? KIND_LABELS[column.kind]}
        </span>
      </th>
      <td className="profile__number">
        {numberFormat.format(profile.empty)}
        {profile.empty > 0 && rows > 0 && (
          <span className="profile__share">
            {' '}
            ({percentFormat.format(profile.empty / rows)})
          </span>
        )}
      </td>
      <td className="profile__number">
        {numberFormat.format(profile.distinct)}
        {profile.filled > 0 && profile.distinct === profile.filled && (
          <span className="profile__share"> (all different)</span>
        )}
      </td>
      <td className="profile__value">{profile.min ?? '—'}</td>
      <td className="profile__value">{profile.max ?? '—'}</td>
      <td>
        <Bars profile={profile} />
        {profile.notConverted > 0 && (
          <p className="profile__warning">
            {numberFormat.format(profile.notConverted)}{' '}
            {profile.notConverted === 1 ? 'cell is' : 'cells are'} not a{' '}
            {column.kind === 'number' ? 'number' : 'date'}.
          </p>
        )}
      </td>
    </tr>
  )
}

/**
 * The built-in column profile. For each column of a result, it shows the number
 * of empty cells, the number of different values, the smallest and the largest
 * value, and a small distribution. The view needs no settings.
 */
export function ProfileView(props: ViewProps) {
  const { columns, rows } = props
  const profiles = useMemo(() => profileColumns(columns, rows), [columns, rows])
  const part = partText(props)
  return (
    <div className="profile">
      <p className="profile__summary">
        <strong>
          {columns.length === 1
            ? '1 column'
            : `${numberFormat.format(columns.length)} columns`}
          , {rowsText(rows.length)}.
        </strong>{' '}
        {part !== null && <span>{part}</span>}
      </p>
      <div className="profile__scroll">
        <table className="profile__table">
          <thead>
            <tr>
              <th scope="col">Column</th>
              <th scope="col" className="profile__number">
                Empty cells
              </th>
              <th scope="col" className="profile__number">
                Different values
              </th>
              <th scope="col">Smallest value</th>
              <th scope="col">Largest value</th>
              <th scope="col">Distribution</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile, index) => (
              <ProfileRow key={index} profile={profile} rows={rows.length} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
