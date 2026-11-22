import { useMemo, useState } from 'react'
import { Modal } from '../connections/Modal'
import { buildCommands } from '../shell/commands'
import { filterGroups, forPlatform, shortcutGroups } from './shortcutList'

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform)

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="shortcuts__keys">
      {keys.map((combination, index) => (
        <span key={combination} className="shortcuts__combination">
          {index > 0 && <span className="shortcuts__or">or</span>}
          {forPlatform(combination, IS_MAC)
            .split(/\+(?=.)/)
            .map((key, part) => (
              <span key={part}>
                {part > 0 && <span aria-hidden="true">+</span>}
                <kbd>{key}</kbd>
              </span>
            ))}
        </span>
      ))}
    </span>
  )
}

/** All keyboard shortcuts of the application, in groups, with a search. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [filter, setFilter] = useState('')
  const groups = useMemo(() => shortcutGroups(buildCommands()), [])
  const shown = filterGroups(groups, filter)

  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} isWide>
      <label className="field">
        <span className="field__label">Find a shortcut</span>
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </label>
      <div className="shortcuts">
        {shown.map((group) => (
          <table key={group.title} className="shortcuts__table">
            <caption>{group.title}</caption>
            <thead className="visually-hidden">
              <tr>
                <th scope="col">Keys</th>
                <th scope="col">Function</th>
              </tr>
            </thead>
            <tbody>
              {group.shortcuts.map((shortcut) => (
                <tr key={shortcut.keys.join() + shortcut.description}>
                  <td>
                    <Keys keys={shortcut.keys} />
                  </td>
                  <td>{shortcut.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
        {shown.length === 0 && <p role="status">No shortcut matches.</p>}
      </div>
      <p className="field__hint">
        {IS_MAC
          ? 'On macOS, Cmd replaces Ctrl.'
          : 'On macOS, use Cmd in place of Ctrl.'}
      </p>
      <div className="modal__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </Modal>
  )
}
