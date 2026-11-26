import { switchConnection } from '../shell/commands'
import type { MenuItem } from '../shell/menu/menuModel'
import { useShellStore } from '../shell/shellStore'
import { useTabsStore } from '../tabs/tabsStore'
import { useConnectionStore } from './connectionStore'
import type { ConnectionProfile } from './formModel'

/** Shows a connection in a detail tab of the editor area. */
export function showConnection(
  profile: ConnectionProfile,
  keep: boolean,
): void {
  useTabsStore
    .getState()
    .openDetail({ kind: 'connection', id: profile.id }, profile.name, keep)
}

/** The actions of a connection. The overflow and the context menu use them. */
export function connectionItems(
  profile: ConnectionProfile,
  onDelete: (profile: ConnectionProfile) => void,
): MenuItem[] {
  const { test, duplicate } = useConnectionStore.getState()
  return [
    {
      kind: 'action',
      label: 'Use in the current tab',
      shortcut: 'Enter',
      run: () => switchConnection(profile.id),
    },
    {
      kind: 'action',
      label: 'Test',
      shortcut: 'Ctrl+Enter',
      run: () => void test(profile),
    },
    {
      kind: 'action',
      label: 'Edit…',
      shortcut: 'F2',
      run: () =>
        useShellStore.getState().editConnection({ profile, isNew: false }),
    },
    {
      kind: 'action',
      label: 'Duplicate',
      run: () => void duplicate(profile.id),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Delete…',
      shortcut: 'Delete',
      run: () => onDelete(profile),
    },
  ]
}
