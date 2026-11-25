import { commands as backend } from '../../bindings'
import { getCatalog } from '../../completion/catalogCache'
import { useSchemaStore } from '../../schema/schemaStore'
import { useTabsStore } from '../../tabs/tabsStore'
import { activeConnection, buildCommands } from '../commands'
import { useShellStore } from '../shellStore'
import type { PaletteEntry } from './paletteSearch'

/** The palette reads a maximum of this number of files and folders. */
export const MAX_FILES = 2000

/** The commands that change a setting. The palette shows them in their own group. */
const SETTING_PREFIXES = ['view.theme-', 'view.layout-', 'view.results-']

/** The commands that can run now. */
export function commandEntries(): PaletteEntry[] {
  return buildCommands()
    .filter((command) => command.isEnabled() && command.id !== 'help.palette')
    .map((command) => ({
      id: command.id,
      group: SETTING_PREFIXES.some((prefix) => command.id.startsWith(prefix))
        ? 'Settings'
        : 'Commands',
      label: command.label,
      detail: command.group,
      shortcut: command.shortcut,
      run: () => void command.run(),
    }))
}

function folderOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : `${path.slice(0, index)}/`
}

/** Reads the files of the workspace, folder by folder, to a limit. */
export async function fileEntries(): Promise<PaletteEntry[]> {
  const entries: PaletteEntry[] = []
  const folders = ['']
  let read = 0
  while (folders.length > 0 && read < MAX_FILES) {
    const folder = folders.shift() ?? ''
    const listing = await backend.fileList(folder).catch(() => null)
    if (!listing || listing.status !== 'ok') continue
    for (const item of listing.data) {
      read += 1
      if (item.is_directory) {
        folders.push(item.path)
        continue
      }
      entries.push({
        id: `file:${item.path}`,
        group: 'Files',
        label: item.name,
        detail: folderOf(item.path),
        run: () => void useTabsStore.getState().openFile(item.path),
      })
    }
  }
  return entries
}

async function showRelation(
  connectionId: string,
  schema: string,
  name: string,
) {
  const store = useSchemaStore.getState()
  if (store.session?.connectionId !== connectionId)
    await store.connect(connectionId)
  useShellStore.getState().showSidebar('schema')
  await useSchemaStore.getState().selectRelation(schema, name)
}

/** The tables and views of the connection of the active tab. */
export async function schemaEntries(): Promise<PaletteEntry[]> {
  const connection = activeConnection()
  if (!connection) return []
  const catalog = await getCatalog(connection.id)
  if (!catalog) return []
  return Object.entries(catalog.relations).flatMap(([schema, relations]) =>
    relations.map((relation) => ({
      id: `schema:${schema}.${relation.name}`,
      group: 'Schema objects' as const,
      label: `${schema}.${relation.name}`,
      detail: `${relation.kind === 'table' ? 'table' : 'view'} · ${connection.name}`,
      run: () => void showRelation(connection.id, schema, relation.name),
    })),
  )
}
