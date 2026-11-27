import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef } from 'react'
import { relativeTime } from '../lib/relativeTime'
import { switchConnection } from '../shell/commands'
import { Icon, type IconName } from '../shell/icons'
import { MenuButton } from '../shell/menu/MenuButton'
import type { MenuItem } from '../shell/menu/menuModel'
import { useShellStore } from '../shell/shellStore'
import { sqlTabOf, useTabsStore } from '../tabs/tabsStore'
import { SideView } from '../view/SideView'
import { useViewKeys, type KeyRow } from '../view/useViewKeys'
import { EmptyState, Loading, NoMatch, ViewError } from '../view/ViewState'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { explainTable, queryRows, writeStarterQuery } from './schemaAi'
import { useSchemaStore } from './schemaStore'
import {
  buildRows,
  kindLabel,
  relationKey,
  schemaKey,
  type TreeRow,
} from './treeModel'

/** The heights of a row in the two densities (view standards, part 1). */
const ROW_HEIGHTS = { comfortable: 28, compact: 24 } as const
const OVERSCAN_ROWS = 15
const INDENT_PX = 16

const LEVELS: Record<Exclude<TreeRow['type'], 'note'>, number> = {
  schema: 1,
  relation: 2,
  column: 3,
}

function levelOf(row: TreeRow): number {
  return row.type === 'note' ? row.depth + 1 : LEVELS[row.type]
}

/** Shows a table in a detail tab of the editor area. */
function showTable(schema: string, name: string, keep: boolean): void {
  useTabsStore
    .getState()
    .openDetail({ kind: 'table', schema, name }, name, keep)
}

/** The items of the menu of a table or a view. The context menu has the same items. */
function relationItems(schema: string, name: string): MenuItem[] {
  const relation = { schema, name }
  return [
    {
      kind: 'action',
      label: 'Show the table',
      run: () => showTable(schema, name, true),
    },
    {
      kind: 'action',
      label: 'Query the first 100 rows',
      shortcut: 'Ctrl+Enter',
      run: () => void queryRows(relation),
    },
    {
      kind: 'action',
      label: 'Copy the name',
      run: () =>
        void navigator.clipboard.writeText(`${schema}.${name}`).catch(() => {}),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Explain the table',
      isAi: true,
      run: () => void explainTable(relation),
    },
    {
      kind: 'action',
      label: 'Write a starter query',
      isAi: true,
      run: () => void writeStarterQuery(relation),
    },
  ]
}

const KIND_ICONS: Record<string, IconName> = {
  table: 'table',
  view: 'view',
  'materialized-view': 'view',
  'foreign-table': 'table',
}

/** The icon of a table, a view, or a MongoDB collection. */
function relationIcon(kind: string, isMongo: boolean): IconName {
  return isMongo && kind === 'table'
    ? 'collection'
    : (KIND_ICONS[kind] ?? 'table')
}

/** The text of a row for type-ahead and for the context menu. */
function rowLabel(row: TreeRow): string {
  switch (row.type) {
    case 'schema':
      return row.schema
    case 'relation':
    case 'column':
      return row.name
    case 'note':
      return row.text
  }
}

/** The parent of a row in the tree, for the Left key. */
function parentOf(row: TreeRow): string | null {
  switch (row.type) {
    case 'relation':
      return schemaKey(row.schema)
    case 'column':
      return relationKey(row.schema, row.relation)
    default:
      return null
  }
}

function RowContent({
  row,
  isMongo,
  onToggle,
}: {
  row: TreeRow
  isMongo: boolean
  /** Opens or closes the node. A click on the chevron does only this. */
  onToggle: () => void
}) {
  const chevron = (isOpen: boolean) => (
    <span
      className="view-row__chevron"
      aria-hidden="true"
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
    >
      <Icon name={isOpen ? 'chevron' : 'chevron-right'} size={16} />
    </span>
  )
  switch (row.type) {
    case 'schema':
      return (
        <>
          {chevron(row.isOpen)}
          <Icon name="database" size={16} />
          <span className="view-row__label" data-system={row.isSystem}>
            {row.schema}
          </span>
          {row.count !== null && (
            <span className="view-row__muted">{row.count}</span>
          )}
        </>
      )
    case 'relation':
      return (
        <>
          {chevron(row.isOpen)}
          <Icon name={relationIcon(row.kind, isMongo)} size={16} />
          <span className="view-row__label" title={`${row.schema}.${row.name}`}>
            {row.name}
          </span>
          {row.kind !== 'table' && (
            <span className="view-row__muted">{kindLabel(row.kind)}</span>
          )}
          <MenuButton
            label={`Actions for ${row.name}`}
            menuLabel={`Actions for ${row.schema}.${row.name}`}
            className="view__icon-button schema__menu"
            isFloating
            items={() => relationItems(row.schema, row.name)}
          >
            <Icon name="more" size={14} />
          </MenuButton>
        </>
      )
    case 'column':
      return (
        <>
          <span
            className="schema__key"
            aria-hidden={!row.isPrimaryKey && !row.isForeignKey}
          >
            {row.isPrimaryKey ? (
              <span role="img" aria-label="Primary key">
                <Icon name="key" size={16} />
              </span>
            ) : row.isForeignKey ? (
              <span role="img" aria-label="Foreign key">
                <Icon name="foreign-key" size={16} />
              </span>
            ) : null}
          </span>
          <span
            className="view-row__label view-row__label--keep"
            title={`${row.name} ${row.typeText}`}
          >
            {row.name}
          </span>
          <span className="view-row__code view-row__code--fill">
            {row.typeText}
          </span>
        </>
      )
    case 'note':
      return (
        <span
          className={
            row.isError ? 'schema__note schema__note--error' : 'schema__note'
          }
          role={row.isError ? 'alert' : 'status'}
        >
          {row.text}
        </span>
      )
  }
}

/** The status line: the number of tables and views, and the age of the data. */
function statusText(rows: TreeRow[], readAt: number | null): string | null {
  if (readAt === null) return null
  const relations = rows.filter((row) => row.type === 'relation')
  const views = relations.filter(
    (row) => row.type === 'relation' && row.kind !== 'table',
  )
  const tables = relations.length - views.length
  const count = `${tables} ${tables === 1 ? 'table' : 'tables'}, ${views.length} ${
    views.length === 1 ? 'view' : 'views'
  }`
  return `${count} · read ${relativeTime(readAt)}`
}

/**
 * The schema view: the schemas, tables, and columns of the connection of the tab,
 * after the view standards. Each node loads when the user opens it.
 */
export function SchemaTree() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  // The schema view shows the connection of the SQL tab.
  const connectionId = useTabsStore(
    (state) => sqlTabOf(state)?.connectionId ?? null,
  )
  const selectedKey = useTabsStore((state) => {
    const detail = state.tabs.find((tab) => tab.id === state.activeId)?.detail
    return detail?.kind === 'table'
      ? relationKey(detail.schema, detail.name)
      : null
  })
  const connections = useWorkspaceStore((state) => state.workspace?.connections)
  const density = useShellStore((state) => state.density)
  const session = useSchemaStore((state) => state.session)
  const isConnecting = useSchemaStore((state) => state.isConnecting)
  const error = useSchemaStore((state) => state.error)
  const schemas = useSchemaStore((state) => state.schemas)
  const relations = useSchemaStore((state) => state.relations)
  const details = useSchemaStore((state) => state.details)
  const expanded = useSchemaStore((state) => state.expanded)
  const filter = useSchemaStore((state) => state.filter)
  const readAt = useSchemaStore((state) => state.readAt)
  const store = useSchemaStore.getState
  const connection = connections?.find((item) => item.id === connectionId)
  const isMongo = connection?.engine === 'mongodb'

  useEffect(() => {
    const current = useSchemaStore.getState().session?.connectionId ?? null
    if (connectionId === current) return
    const { connect, disconnect } = useSchemaStore.getState()
    void (connectionId ? connect(connectionId) : disconnect())
  }, [connectionId])

  const rows = useMemo(
    () => buildRows({ schemas, relations, details, expanded, filter }),
    [schemas, relations, details, expanded, filter],
  )
  const rowHeight = ROW_HEIGHTS[density]
  // The virtual list is not compatible with the React Compiler. This project does not use the compiler.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN_ROWS,
  })

  const keyRows: KeyRow[] = useMemo(
    () =>
      rows
        .filter((row) => row.type !== 'note')
        .map((row) => ({
          key: row.key,
          label: rowLabel(row),
          level: levelOf(row),
          isExpandable: row.type === 'schema' || row.type === 'relation',
          isExpanded:
            (row.type === 'schema' || row.type === 'relation') && row.isOpen,
          parentKey: parentOf(row),
        })),
    [rows],
  )
  const byKey = useMemo(
    () => new Map(rows.map((row) => [row.key, row])),
    [rows],
  )
  const relationOf = (key: string) => {
    const row = byKey.get(key)
    if (row?.type === 'relation') return { schema: row.schema, name: row.name }
    if (row?.type === 'column')
      return { schema: row.schema, name: row.relation }
    return null
  }
  const toggle = (key: string) => {
    const row = byKey.get(key)
    if (row?.type === 'schema') void store().toggleSchema(row.schema)
    if (row?.type === 'relation')
      void store().toggleRelation(row.schema, row.name)
  }

  const keys = useViewKeys({
    kind: 'tree',
    rows: keyRows,
    selectedKey,
    filterRef,
    scrollToIndex: (index) => {
      const row = keyRows[index]
      const position = rows.findIndex((item) => item.key === row?.key)
      if (position >= 0) virtualizer.scrollToIndex(position)
    },
    onToggle: (key, expand) => {
      const row = byKey.get(key)
      if (
        row &&
        (row.type === 'schema' || row.type === 'relation') &&
        row.isOpen !== expand
      ) {
        toggle(key)
      }
    },
    // Space and a click show the table in the preview tab. The focus stays here.
    onSelect: (key) => {
      const relation = relationOf(key)
      if (relation) showTable(relation.schema, relation.name, false)
      else toggle(key)
    },
    onOpen: (key) => {
      const relation = relationOf(key)
      if (relation) showTable(relation.schema, relation.name, true)
      else toggle(key)
    },
    onSecondary: (key) => {
      const relation = relationOf(key)
      if (relation) void queryRows(relation)
    },
    onRefresh: () => void store().refresh(),
    onEscape: () => useTabsStore.getState().closePreview(),
    contextItems: (key) => {
      const row = byKey.get(key)
      return row?.type === 'relation' ? relationItems(row.schema, row.name) : []
    },
  })

  const hasRelations = rows.some((row) => row.type === 'relation')
  const isNoMatch =
    filter.trim() !== '' &&
    !hasRelations &&
    Object.values(relations).some((load) => load.status === 'loaded')

  const body = () => {
    if (!connectionId) {
      return (
        <EmptyState
          text="The tab has no connection. Select a connection for the tab. The schema of that connection shows here."
          action={{
            label: 'Select a connection',
            run: () => useShellStore.getState().showSidebar('connections'),
          }}
        />
      )
    }
    return (
      <>
        {error && (
          <ViewError
            title="Cannot read the schema."
            detail={error}
            onRetry={() =>
              void (session ? store().refresh() : store().connect(connectionId))
            }
          />
        )}
        {(isConnecting || schemas?.status === 'loading') && (
          <Loading
            text={`Reading the schema of ${session?.database ?? connection?.name ?? 'the database'}…`}
          />
        )}
        {isNoMatch ? (
          <NoMatch
            noun="tables"
            filter={filter}
            onClear={() => store().setFilter('')}
          />
        ) : (
          <div ref={scrollRef} className="schema__scroll">
            <div
              className="schema__rows"
              role="tree"
              aria-label={`Database objects of ${session?.database ?? 'the database'}`}
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index]
                const level = levelOf(row)
                const index = keyRows.findIndex(
                  (keyRow) => keyRow.key === row.key,
                )
                const props =
                  index >= 0
                    ? keys.rowProps(keyRows[index], index)
                    : { role: 'none' }
                return (
                  <div
                    key={row.key}
                    {...props}
                    className="view-row schema__row"
                    style={{
                      height: rowHeight,
                      transform: `translateY(${item.start}px)`,
                      paddingLeft: `${6 + (level - 1) * INDENT_PX}px`,
                    }}
                  >
                    <RowContent
                      row={row}
                      isMongo={isMongo}
                      onToggle={() => toggle(row.key)}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <SideView
      title="Schema"
      scope={
        connection
          ? {
              text: session
                ? `${connection.name} › ${session.database}`
                : connection.name,
              label: `Scope: ${connection.name}${
                session ? `, database ${session.database}` : ''
              }. Change the scope`,
              items: () =>
                (connections ?? []).map((item) => ({
                  kind: 'radio' as const,
                  label: item.name,
                  checked: item.id === connectionId,
                  run: () => switchConnection(item.id),
                })),
            }
          : { text: 'No connection', label: 'No connection' }
      }
      primary={{
        icon: 'refresh',
        label: 'Read the schema again',
        shortcut: 'F5',
        disabled: !session,
        run: () => void store().refresh(),
      }}
      overflow={() => [
        {
          kind: 'action',
          label: 'Read the schema again',
          shortcut: 'F5',
          disabled: !session,
          run: () => void store().refresh(),
        },
        {
          kind: 'action',
          label: 'Close the preview tab',
          run: () => useTabsStore.getState().closePreview(),
        },
      ]}
      filter={
        connectionId
          ? {
              value: filter,
              onChange: (value) => store().setFilter(value),
              label: 'Filter the tables',
              placeholder: 'Filter  /',
              inputRef: filterRef,
              onLeave: () => keys.focusRow(),
            }
          : undefined
      }
      status={
        connectionId
          ? isNoMatch
            ? `0 of ${keyRows.length} objects`
            : statusText(rows, readAt)
          : null
      }
    >
      {body()}
      {keys.contextMenu}
    </SideView>
  )
}
