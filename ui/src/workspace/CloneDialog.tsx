import { open } from '@tauri-apps/plugin-dialog'
import { useState, type FormEvent } from 'react'
import { commands } from '../bindings'
import { Modal } from '../connections/Modal'
import { toMessage } from '../lib/errors'
import { useWorkspaceStore } from './workspaceStore'

type Props = { onClose: () => void }

/** The last part of a repository URL, without `.git`. */
function folderNameOf(url: string): string {
  const last =
    url
      .trim()
      .replace(/[/\\]+$/, '')
      .split(/[/\\:]/)
      .at(-1) ?? ''
  return last.replace(/\.git$/, '')
}

/** Clones a repository into a new folder and opens the folder as the workspace. */
export function CloneDialog({ onClose }: Props) {
  const openPath = useWorkspaceStore((state) => state.openPath)
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState('')
  const [name, setName] = useState('')
  const [isCloning, setIsCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const folderName = name || folderNameOf(url)

  const chooseParent = async () => {
    try {
      const selected = await open({ directory: true, multiple: false })
      if (typeof selected === 'string') setParent(selected)
    } catch (failure) {
      setError(toMessage(failure))
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setIsCloning(true)
    setError(null)
    try {
      const result = await commands.gitClone(url.trim(), parent, folderName)
      if (result.status === 'error') {
        setError(result.error.message)
      } else {
        await openPath(result.data)
        onClose()
      }
    } catch (failure) {
      setError(toMessage(failure))
    } finally {
      setIsCloning(false)
    }
  }

  return (
    <Modal title="Clone a repository" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span className="field__label">Repository URL</span>
          <input
            required
            value={url}
            placeholder="git@example.com:team/sql.git"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <div className="field">
          <span className="field__label">Parent folder</span>
          <div className="git__row">
            <span className="clone__parent">
              {parent || 'No folder selected'}
            </span>
            <button
              type="button"
              className="button button--small"
              onClick={() => void chooseParent()}
            >
              Select folder…
            </button>
          </div>
        </div>
        <label className="field">
          <span className="field__label">Folder name</span>
          <input
            value={folderName}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p className="field__hint">
          Git uses your SSH agent or your credential helper. The application
          does not ask for a password.
        </p>
        {isCloning && <p role="status">Cloning…</p>}
        {error && (
          <p className="message message--error git__output" role="alert">
            {error}
          </p>
        )}
        <div className="modal__actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={isCloning || !url.trim() || !parent || !folderName}
          >
            Clone
          </button>
        </div>
      </form>
    </Modal>
  )
}
