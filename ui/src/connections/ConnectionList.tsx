import { useState } from 'react'
import { commands } from '../bindings'
import { toMessage } from '../lib/errors'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { ConfirmDialog } from './ConfirmDialog'
import { ConnectionForm } from './ConnectionForm'
import { ConnectionItem } from './ConnectionItem'
import { useConnectionStore } from './connectionStore'
import type { ConnectionProfile } from './formModel'

// A stable value. A new array on each call makes the store selector loop.
const NO_CONNECTIONS: ConnectionProfile[] = []

type Editing = { profile: ConnectionProfile; isNew: boolean }

export function ConnectionList() {
  const connections = useWorkspaceStore(
    (state) => state.workspace?.connections ?? NO_CONNECTIONS,
  )
  const setError = useWorkspaceStore((state) => state.setError)
  const tests = useConnectionStore((state) => state.tests)
  const test = useConnectionStore((state) => state.test)
  const remove = useConnectionStore((state) => state.remove)
  const duplicate = useConnectionStore((state) => state.duplicate)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [deleting, setDeleting] = useState<ConnectionProfile | null>(null)

  const handleNew = async () => {
    try {
      setEditing({ profile: await commands.connectionTemplate(), isNew: true })
    } catch (error) {
      setError(toMessage(error))
    }
  }

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
          onClick={() => void handleNew()}
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
              onEdit={() => setEditing({ profile, isNew: false })}
              onDuplicate={() => void duplicate(profile.id)}
              onDelete={() => setDeleting(profile)}
            />
          ))}
        </ul>
      )}

      {editing && (
        <ConnectionForm
          key={editing.profile.id}
          profile={editing.profile}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
        />
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
