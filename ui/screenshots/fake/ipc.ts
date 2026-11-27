import type { Channel } from '@tauri-apps/api/core'
import type { AskRequest_Serialize, AssistantEvent } from '../../src/bindings'
import { ask } from './assistant'
import {
  commitDiff,
  commitFiles,
  COMMITS,
  consoleRun,
  OVERVIEW,
  workingDiff,
} from './git'
import { searchHistory } from './history'
import { readPlan } from './plan'
import { runStatement } from './results'
import { relationDetail, relationList, schemaList } from './schema'
import {
  ARCHIVE_ID,
  ENGINES,
  FILES,
  listDirectory,
  PREFERENCES,
  RECENT,
  WORKSPACE,
} from './workspace'

/**
 * A fake of the Tauri backend for the screenshots. The real bindings call
 * `window.__TAURI_INTERNALS__.invoke`. This module gives that function, thus the
 * application runs without changes in a normal browser.
 */

type Args = Record<string, unknown>
type Handler = (args: Args) => unknown

/** The initial tabs. The screenshot script can replace them before the page loads. */
export type InitialTabs = { files: string[]; active: string }

const SERVER_VERSIONS: Record<string, string> = {
  postgres: '17.2',
  mongodb: '8.0.4',
}

/** The open sessions: the session identifier and its connection. */
const sessions = new Map<number, string>()
let nextSessionId = 1

function connectionOf(sessionId: unknown) {
  const id = sessions.get(Number(sessionId))
  return WORKSPACE.connections.find((connection) => connection.id === id)
}

function isMongo(sessionId: unknown): boolean {
  return connectionOf(sessionId)?.id === ARCHIVE_ID
}

function fail(message: string): never {
  throw { kind: 'internal', message, issues: [] }
}

function initialTabs(): InitialTabs {
  const stored = (window as { __SCREENSHOT_TABS__?: InitialTabs })
    .__SCREENSHOT_TABS__
  return stored ?? { files: ['queries/items.sql'], active: 'queries/items.sql' }
}

/** The connection of a file tab: the MongoDB files use the archive. */
function connectionFor(path: string): string {
  return path.endsWith('.mongodb.js') ? ARCHIVE_ID : WORKSPACE.connections[0].id
}

function uiState() {
  const { files, active } = initialTabs()
  return {
    tabs: files.map((path) => ({
      id: `tab-${path}`,
      title: path.split('/').at(-1) ?? path,
      path,
      content: null,
      connection_id: connectionFor(path),
    })),
    active_tab: `tab-${active}`,
  }
}

const ok = null

const HANDLERS: Record<string, Handler> = {
  app_info: () => ({ name: 'Tabloxide', version: '0.1.0' }),
  update_check: () => ({ status: 'up-to-date' }),
  workspace_current: () => WORKSPACE,
  workspace_open: () => WORKSPACE,
  workspace_recent: () => RECENT,
  workspace_watch: () => ok,
  engine_list: () => ENGINES,
  preferences_load: () => PREFERENCES,
  preferences_save: (args) => args.preferences,
  ui_state_load: () => uiState(),
  ui_state_save: () => ok,
  assistant_status: () => ({ has_key: true }),
  assistant_models: () => ({
    status: 'ready',
    is_from_cache: true,
    list: { models: [], fetched_at_secs: 1_764_150_000, new_ids: [] },
  }),
  connection_test: (args) => ({
    status: 'connected',
    server: {
      version:
        SERVER_VERSIONS[(args.profile as { engine?: string }).engine ?? ''] ??
        '17.2',
    },
  }),
  session_open: (args) => {
    const connection = WORKSPACE.connections.find(
      (item) => item.id === args.connectionId,
    )
    if (!connection) fail('The connection does not exist.')
    const id = nextSessionId++
    sessions.set(id, connection.id)
    return {
      status: 'connected',
      session: {
        id,
        connection_id: connection.id,
        database: connection.database,
        server: { version: SERVER_VERSIONS[connection.engine ?? 'postgres'] },
      },
    }
  },
  session_close: (args) => {
    sessions.delete(Number(args.sessionId))
    return ok
  },
  query_preview: (args) => {
    const sql = String(args.sql)
    return [{ range: { from: 0, to: sql.trimEnd().length }, risk: null }]
  },
  query_run: (args) => ({
    statements: [runStatement(String(args.sql))],
    open_result: null,
  }),
  query_cancel: () => ok,
  result_fetch: () => null,
  result_close: () => ok,
  plan_check: () => ({ explain: null, measure: null }),
  plan_read: (args) => readPlan(String(args.sql), Boolean(args.measure)),
  schema_list: (args) => schemaList(isMongo(args.sessionId)),
  schema_relations: (args) =>
    relationList(isMongo(args.sessionId), String(args.schema)),
  schema_relation_detail: (args) =>
    relationDetail(isMongo(args.sessionId), String(args.relation)),
  schema_sample: (args) =>
    runStatement(`SELECT * FROM ${String(args.relation)} LIMIT 100`),
  file_list: (args) => listDirectory(String(args.directory)),
  file_read: (args) => FILES[String(args.path)] ?? fail('No such file.'),
  file_write: () => ok,
  git_overview: () => OVERVIEW,
  git_log: (args) =>
    COMMITS.slice(Number(args.skip), Number(args.skip) + Number(args.limit)),
  git_commit_files: (args) => commitFiles(String(args.id)),
  git_commit_diff: (args) => commitDiff(String(args.path)),
  git_diff: (args) => workingDiff(String(args.path)),
  git_stage: () => ok,
  git_unstage: () => ok,
  git_console_history: () => [],
  git_console_names: () => ({
    branches: ['main', 'monthly-report', 'vacuum-checks'],
    remotes: ['origin'],
    tags: [],
    files: Object.keys(FILES),
  }),
  git_console_run: (args) => consoleRun(String(args.line)),
  history_search: (args) => searchHistory(String(args.query)),
}

async function invoke(command: string, args: Args = {}): Promise<unknown> {
  if (command === 'assistant_ask') {
    const channel = args.onEvent as Channel<AssistantEvent>
    return ask(args.request as AskRequest_Serialize, (event) =>
      channel.onmessage(event),
    )
  }
  if (command.startsWith('plugin:')) return null
  const handler = HANDLERS[command]
  if (!handler) fail(`The fake backend has no command ${command}.`)
  return handler(args)
}

let nextCallbackId = 1

/** Installs the fake backend. Call it before the application loads. */
export function installFakeBackend(): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {
      invoke,
      transformCallback: () => nextCallbackId++,
      unregisterCallback: () => {},
      convertFileSrc: (path: string) => path,
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { windowLabel: 'main', label: 'main' },
      },
    },
  })
}
