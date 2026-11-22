import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef } from 'react'
import { Icon } from '../shell/icons'
import { useTabsStore } from '../tabs/tabsStore'
import { useSchemaStore } from './schemaStore'
import { buildRows, kindLabel, type TreeRow } from './treeModel'

const ROW_HEIGHT = 24
const OVERSCAN_ROWS = 15
const INDENT_REM = 0.9

const DEPTHS: Record<Exclude<TreeRow['type'], 'note'>, number> = {
  schema: 0,
  relation: 1,
  group: 2,
  item: 2,
}

function depthOf(row: TreeRow): number {
  return row.type === 'note' ? row.depth : DEPTHS[row.type]
}

function Row({ row }: { row: TreeRow }) {
  const toggleSchema = useSchemaStore((state) => state.toggleSchema)
  const toggleRelation = useSchemaStore((state) => state.toggleRelation)
  const selectRelation = useSchemaStore((state) => state.selectRelation)
  const arrow = (isOpen: boolean) => (
    <span aria-hidden="true">{isOpen ? '▾' : '▸'} </span>
  )

  switch (row.type) {
    case 'schema':
      return (
        <button
          type="button"
          className="schema__button"
          data-system={row.isSystem}
          aria-expanded={row.isOpen}
          onClick={() => void toggleSchema(row.schema)}
        >
          {arrow(row.isOpen)}
          {row.schema}
        </button>
      )
    case 'relation':
      return (
        <>
          <button
            type="button"
            className="schema__toggle"
            aria-expanded={row.isOpen}
            aria-label={`Columns of ${row.name}`}
            onClick={() => void toggleRelation(row.schema, row.name)}
          >
            {arrow(row.isOpen)}
          </button>
          <button
            type="button"
            className="schema__button"
            title={`Show the ${kindLabel(row.kind)} ${row.schema}.${row.name}`}
            onClick={() => void selectRelation(row.schema, row.name)}
          >
            {row.name}{' '}
            {row.kind !== 'table' && (
              <span className="schema__detail">{kindLabel(row.kind)}</span>
            )}
          </button>
        </>
      )
    case 'group':
      return <span className="schema__group">{row.label}</span>
    case 'item':
      return (
        <span className="schema__item" title={`${row.label} ${row.detail}`}>
          {row.label} <span className="schema__detail">{row.detail}</span>
        </span>
      )
    case 'note':
      return (
        <span
          className={
            row.isError ? 'files__note files__note--error' : 'files__note'
          }
          role={row.isError ? 'alert' : undefined}
        >
          {row.text}
        </span>
      )
  }
}

/** The schemas, tables, and columns of one connection. Each node loads when the user opens it. */
export function SchemaTree() {
  const scrollRef = useRef<HTMLDivElement>(null)
  // The schema browser shows the connection of the active tab.
  const connectionId = useTabsStore(
    (state) =>
      state.tabs.find((tab) => tab.id === state.activeId)?.connectionId ?? null,
  )
  const session = useSchemaStore((state) => state.session)
  const isConnecting = useSchemaStore((state) => state.isConnecting)
  const error = useSchemaStore((state) => state.error)
  const schemas = useSchemaStore((state) => state.schemas)
  const relations = useSchemaStore((state) => state.relations)
  const details = useSchemaStore((state) => state.details)
  const expanded = useSchemaStore((state) => state.expanded)
  const filter = useSchemaStore((state) => state.filter)
  const connect = useSchemaStore((state) => state.connect)
  const disconnect = useSchemaStore((state) => state.disconnect)
  const refresh = useSchemaStore((state) => state.refresh)
  const setFilter = useSchemaStore((state) => state.setFilter)

  useEffect(() => {
    const current = useSchemaStore.getState().session?.connectionId ?? null
    if (connectionId === current) return
    void (connectionId ? connect(connectionId) : disconnect())
  }, [connectionId, connect, disconnect])

  const rows = useMemo(
    () => buildRows({ schemas, relations, details, expanded, filter }),
    [schemas, relations, details, expanded, filter],
  )
  // The virtual list is not compatible with the React Compiler. This project does not use the compiler.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
  })

  return (
    <section className="schema" aria-label="Schema">
      <div className="connections__header">
        <h2 className="pane__title">Schema</h2>
        <button
          type="button"
          className="icon-link"
          aria-label="Read the schema again"
          title="Read the schema again (F5)"
          disabled={!session}
          onClick={() => void refresh()}
        >
          <Icon name="refresh" size={16} />
        </button>
      </div>
      {session && <p className="schema__database">{session.database}</p>}
      {isConnecting && <p role="status">Connecting…</p>}
      {error && (
        <p className="message message--error" role="alert">
          {error}
        </p>
      )}
      {session && (
        <input
          type="search"
          className="history__search"
          aria-label="Filter the tables"
          placeholder="Filter the tables"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}
      {!session && !isConnecting && !error && (
        <p className="pane__hint">
          Select a connection for the tab. The schema of that connection shows
          here.
        </p>
      )}
      <div ref={scrollRef} className="schema__scroll">
        <ul
          className="schema__rows"
          aria-label="Database objects"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            return (
              <li
                key={row.key}
                className="schema__row"
                style={{
                  height: ROW_HEIGHT,
                  transform: `translateY(${item.start}px)`,
                  paddingLeft: `${depthOf(row) * INDENT_REM}rem`,
                }}
              >
                <Row row={row} />
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
