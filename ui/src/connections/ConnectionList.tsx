import { useState } from 'react'
import { newConnection } from '../shell/commands'
import { useShellStore } from '../shell/shellStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { ConfirmDialog } from './ConfirmDialog'
import { ConnectionItem } from './ConnectionItem'
import { useConnectionStore } from './connectionStore'
import type { ConnectionProfile } from './formModel'

// A stable value. A new array on each call makes the store selector loop.
const NO_CONNECTIONS: ConnectionProfile[] = []

export function ConnectionList() {
  const connections = useWorkspaceStore(
    (state) => state.workspace?.connections ?? NO_CONNECTIONS,
  )
  const tests = useConnectionStore((state) => state.tests)
  const test = useConnectionStore((state) => state.test)
  const remove = useConnectionStore((state) => state.remove)
  const duplicate = useConnectionStore((state) => state.duplicate)
  const editConnection = useShellStore((state) => state.editConnection)
  const [deleting, setDeleting] = useState<ConnectionProfile | null>(null)

  const handleConfirmDelete = () => {
    if (deleting) void remove(deleting.id)
    setDeleting(null)
  }

  return (
    <section className="connections" aria-labelledby="connections-title">
      <div className="connections__header">
        <h2 id="connections-title" className="pane__title">
          Connections
        </h2>
        <button
          type="button"
          className="button button--small"
          onClick={() => void newConnection()}
        >
          New
        </button>
      </div>

      {connections.length === 0 ? (
        <p className="pane__hint">This workspace has no connections.</p>
      ) : (
        <ul className="connections__list">
          {connections.map((profile) => (
            <ConnectionItem
              key={profile.id}
              profile={profile}
              testState={tests[profile.id]}
              onTest={() => void test(profile)}
              onEdit={() => editConnection({ profile, isNew: false })}
              onDuplicate={() => void duplicate(profile.id)}
              onDelete={() => setDeleting(profile)}
            />
          ))}
        </ul>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete connection"
          message={`Delete the connection "${deleting.name}"? This also removes its stored password.`}
          confirmLabel="Delete"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  )
}
