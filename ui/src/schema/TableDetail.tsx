import { useState } from 'react'
import { AiAction } from '../assistant/AiAction'
import { ResultGrid } from '../results/ResultGrid'
import { Icon } from '../shell/icons'
import {
  explainTableRequest,
  openStarterQuery,
  queryRows,
  starterQueryRequest,
} from './schemaAi'
import { useSchemaStore } from './schemaStore'
import {
  foreignKeyColumns,
  foreignKeyTargets,
  kindLabel,
  relationKey,
  type RelationDetail,
} from './treeModel'
import { countText } from '../lib/countText'

const NO_FETCH = () => {}

const CONSTRAINT_LABELS = {
  'primary-key': 'Primary key',
  'foreign-key': 'Foreign key',
  unique: 'Unique',
  check: 'Check',
  exclusion: 'Exclusion',
  other: 'Other',
}

function Sample() {
  const sample = useSchemaStore((state) => state.sample)
  if (!sample || sample.status === 'loading') {
    return <p role="status">Loading the rows…</p>
  }
  if (sample.status === 'failed') {
    return (
      <p className="message message--error" role="alert">
        {sample.message}
      </p>
    )
  }
  const { outcome } = sample.data
  if (outcome.type === 'failed') {
    return (
      <p className="message message--error" role="alert">
        {outcome.error.message}
      </p>
    )
  }
  if (outcome.type !== 'rows') return null
  return (
    <>
      <p className="results__status">
        The first {countText(outcome.rows.length, 'row')}. To see more rows, run
        a query.
      </p>
      <div className="table-detail__grid">
        <ResultGrid
          columns={outcome.columns}
          rows={outcome.rows}
          hasMore={false}
          onNeedMore={NO_FETCH}
        />
      </div>
    </>
  )
}

/** Columns, then indexes, then constraints: the structure as one page. */
function Structure({ detail }: { detail: RelationDetail }) {
  const foreign = foreignKeyColumns(detail)
  const targets = foreignKeyTargets(detail)
  const columnWord = detail.columns_from_sample ? 'Fields' : 'Columns'
  return (
    <>
      {detail.columns_from_sample && (
        <p className="results__status">
          The fields come from a sample of 100 documents. The collection can
          have more fields. They are not rules.
        </p>
      )}
      <table className="table-detail__table">
        <caption>
          {columnWord}{' '}
          <span className="table-detail__count">{detail.columns.length}</span>
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Key</span>
            </th>
            <th scope="col">Name</th>
            <th scope="col">Type</th>
            <th scope="col">Null</th>
            <th scope="col">Default</th>
            <th scope="col">References</th>
          </tr>
        </thead>
        <tbody>
          {detail.columns.map((column) => (
            <tr key={column.name}>
              <td className="table-detail__key">
                {column.is_primary_key ? (
                  <span role="img" aria-label="Primary key">
                    <Icon name="key" size={16} />
                  </span>
                ) : foreign.has(column.name) ? (
                  <span role="img" aria-label="Foreign key">
                    <Icon name="foreign-key" size={16} />
                  </span>
                ) : null}
              </td>
              <th scope="row">{column.name}</th>
              <td className="table-detail__code">{column.data_type}</td>
              <td>{column.is_nullable ? 'yes' : ''}</td>
              <td className="table-detail__code">{column.default ?? ''}</td>
              <td>{targets.get(column.name) ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail.indexes.length > 0 && (
        <table className="table-detail__table">
          <caption>
            Indexes{' '}
            <span className="table-detail__count">{detail.indexes.length}</span>
          </caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Definition</th>
              <th scope="col">
                <span className="visually-hidden">Unique</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {detail.indexes.map((index) => (
              <tr key={index.name}>
                <th scope="row">{index.name}</th>
                <td className="table-detail__code">{index.definition}</td>
                <td>{index.is_unique ? 'unique' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {detail.constraints.length > 0 && (
        <table className="table-detail__table">
          <caption>
            Constraints{' '}
            <span className="table-detail__count">
              {detail.constraints.length}
            </span>
          </caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col">Definition</th>
            </tr>
          </thead>
          <tbody>
            {detail.constraints.map((constraint) => (
              <tr key={constraint.name}>
                <th scope="row">{constraint.name}</th>
                <td>{CONSTRAINT_LABELS[constraint.kind]}</td>
                <td className="table-detail__code">{constraint.definition}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

type Section = 'structure' | 'rows'

/** The detail of the table that the user selected: its structure, or its first rows. */
export function TableDetail() {
  const selected = useSchemaStore((state) => state.selected)
  const kind = useSchemaStore((state) => {
    const schema = state.selected?.schema
    const load = schema ? state.relations[schema] : undefined
    return load?.status === 'loaded'
      ? load.data.find((relation) => relation.name === state.selected?.name)
          ?.kind
      : undefined
  })
  const detail = useSchemaStore((state) =>
    state.selected
      ? state.details[relationKey(state.selected.schema, state.selected.name)]
      : undefined,
  )
  const [section, setSection] = useState<Section>('structure')
  if (!selected) {
    return (
      <p className="pane__hint">
        Select a table in the schema view to see its structure here.
      </p>
    )
  }
  const isSampled =
    detail?.status === 'loaded' && detail.data.columns_from_sample
  const kindText =
    isSampled && kind === 'table' ? 'collection' : kind && kindLabel(kind)

  return (
    <div className="table-detail">
      <div className="table-detail__header">
        <h3 className="table-detail__title">
          {selected.schema}.{selected.name}
        </h3>
        {kindText && <span className="table-detail__kind">{kindText}</span>}
        <span className="view__spacer" />
        <button
          type="button"
          className="button button--small"
          aria-keyshortcuts="Control+Enter"
          title="Open the first 100 rows in a new tab and run the query (Ctrl+Enter in the schema view)"
          onClick={() => void queryRows(selected)}
        >
          <Icon name="play" size={14} />
          Query the rows
        </button>
        <AiAction
          label="Explain the table"
          title="The AI explains the table from its structure. The request sends no rows."
          request={() => explainTableRequest(selected)}
        />
        <AiAction
          label="Write a starter query"
          title="The AI writes a first query. It opens in a new tab, and the application does not run it."
          request={() => starterQueryRequest(selected)}
          after={(session) => openStarterQuery(selected, session)}
        />
      </div>
      <div className="view__modes" role="tablist" aria-label="Table detail">
        {(['structure', 'rows'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            className="view__mode"
            aria-selected={section === value}
            onClick={() => setSection(value)}
          >
            {value === 'structure'
              ? 'Structure'
              : isSampled
                ? 'Documents'
                : 'Rows'}
          </button>
        ))}
      </div>
      <div className="table-detail__section" role="tabpanel">
        {section === 'structure' && (
          <>
            {(!detail || detail.status === 'loading') && (
              <p role="status">Loading the structure…</p>
            )}
            {detail?.status === 'failed' && (
              <p className="message message--error" role="alert">
                {detail.message}
              </p>
            )}
            {detail?.status === 'loaded' && <Structure detail={detail.data} />}
          </>
        )}
        {section === 'rows' && <Sample />}
      </div>
    </div>
  )
}
