import { ConnectionForm } from '../connections/ConnectionForm'
import { useShellStore } from './shellStore'

/** The connection form for the connection that a menu, the palette, or the list edits. */
export function ConnectionEditor() {
  const editing = useShellStore((state) => state.connectionEditing)
  const editConnection = useShellStore((state) => state.editConnection)
  if (!editing) return null
  return (
    <ConnectionForm
      key={editing.profile.id}
      profile={editing.profile}
      isNew={editing.isNew}
      onClose={() => editConnection(null)}
    />
  )
}
