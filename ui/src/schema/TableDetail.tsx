import { AiAction } from '../assistant/AiAction'
import { ResultGrid } from '../results/ResultGrid'
import {
  explainTableRequest,
  openStarterQuery,
  starterQueryRequest,
} from './schemaAi'
import { useSchemaStore } from './schemaStore'
import { relationKey } from './treeModel'

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
        The first {outcome.rows.length} rows. To see more rows, run a query.
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

/** The structure and a bounded row sample of the table that the user selected. */
export function TableDetail() {
  const selected = useSchemaStore((state) => state.selected)
  const detail = useSchemaStore((state) =>
    state.selected
      ? state.details[relationKey(state.selected.schema, state.selected.name)]
      : undefined,
  )
  if (!selected) {
    return (
      <p className="pane__hint">
        Select a table in the schema browser to see its structure here.
      </p>
    )
  }

  return (
    <div className="table-detail">
      <div className="table-detail__header">
        <h3 className="table-detail__title">
          {selected.schema}.{selected.name}
        </h3>
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
      {(!detail || detail.status === 'loading') && (
        <p role="status">Loading the structure…</p>
      )}
      {detail?.status === 'failed' && (
        <p className="message message--error" role="alert">
          {detail.message}
        </p>
      )}
      {detail?.status === 'loaded' && (
        <>
          <table className="table-detail__table">
            <caption>Columns</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                <th scope="col">Nullable</th>
                <th scope="col">Default</th>
                <th scope="col">Key</th>
              </tr>
            </thead>
            <tbody>
              {detail.data.columns.map((column) => (
                <tr key={column.name}>
                  <th scope="row">{column.name}</th>
                  <td>{column.data_type}</td>
                  <td>{column.is_nullable ? 'yes' : 'no'}</td>
                  <td>{column.default ?? ''}</td>
                  <td>{column.is_primary_key ? 'primary key' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.data.indexes.length > 0 && (
            <table className="table-detail__table">
              <caption>Indexes</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Definition</th>
                </tr>
              </thead>
              <tbody>
                {detail.data.indexes.map((index) => (
                  <tr key={index.name}>
                    <th scope="row">{index.name}</th>
                    <td>{index.definition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {detail.data.constraints.length > 0 && (
            <table className="table-detail__table">
              <caption>Constraints</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Definition</th>
                </tr>
              </thead>
              <tbody>
                {detail.data.constraints.map((constraint) => (
                  <tr key={constraint.name}>
                    <th scope="row">{constraint.name}</th>
                    <td>{CONSTRAINT_LABELS[constraint.kind]}</td>
                    <td>{constraint.definition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <h4 className="table-detail__subtitle">Rows</h4>
      <Sample />
    </div>
  )
}
