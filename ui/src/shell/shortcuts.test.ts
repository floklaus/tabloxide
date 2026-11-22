import { describe, expect, test, vi } from 'vitest'
import type { Command } from './commands'
import { commandForEvent, handleShortcut, shortcutOf } from './shortcuts'

function key(init: KeyboardEventInit & { code: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', { cancelable: true, ...init })
}

function command(id: string, shortcut: string, isEnabled = true): Command {
  return {
    id,
    label: id,
    group: 'View',
    shortcut,
    isEnabled: () => isEnabled,
    run: vi.fn(),
  }
}

describe('shortcutOf', () => {
  test('writes the modifiers and the physical key', () => {
    expect(shortcutOf(key({ code: 'KeyK', key: 'k', ctrlKey: true }))).toBe(
      'Ctrl+K',
    )
    expect(
      shortcutOf(
        key({ code: 'KeyN', key: 'N', ctrlKey: true, shiftKey: true }),
      ),
    ).toBe('Ctrl+Shift+N')
    // Alt changes the character on macOS. The shortcut uses the physical key.
    expect(
      shortcutOf(key({ code: 'KeyS', key: 'ß', ctrlKey: true, altKey: true })),
    ).toBe('Ctrl+Alt+S')
    // Cmd on macOS is the same as Ctrl.
    expect(shortcutOf(key({ code: 'Comma', key: ',', metaKey: true }))).toBe(
      'Ctrl+,',
    )
    expect(shortcutOf(key({ code: 'F11', key: 'F11' }))).toBe('F11')
    expect(
      shortcutOf(
        key({ code: 'Equal', key: '+', ctrlKey: true, shiftKey: true }),
      ),
    ).toBe('Ctrl+Shift+=')
  })
})

describe('handleShortcut', () => {
  const commands = [
    command('palette', 'Ctrl+K'),
    command('save-all', 'Ctrl+Alt+S'),
    command('disabled', 'Ctrl+D', false),
    command('zoom', 'Ctrl+='),
  ]

  test('runs the command of the shortcut', () => {
    const event = key({ code: 'KeyK', key: 'k', ctrlKey: true })

    expect(handleShortcut(event, commands)).toBe(true)
    expect(commands[0].run).toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  test('does not run a disabled command, and still takes the key', () => {
    const event = key({ code: 'KeyD', key: 'd', ctrlKey: true })

    expect(handleShortcut(event, commands)).toBe(true)
    expect(commands[2].run).not.toHaveBeenCalled()
  })

  test('ignores a key that the editor handled and a key in a dialog', () => {
    const handled = key({ code: 'KeyK', key: 'k', ctrlKey: true })
    handled.preventDefault()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const input = document.createElement('input')
    dialog.append(input)
    document.body.append(dialog)
    const inDialog = key({
      code: 'KeyK',
      key: 'k',
      ctrlKey: true,
      bubbles: true,
    })

    input.dispatchEvent(inDialog)

    expect(handleShortcut(handled, commands)).toBe(false)
    expect(handleShortcut(inDialog, commands)).toBe(false)
    expect(
      commandForEvent(key({ code: 'KeyQ', key: 'q' }), commands),
    ).toBeNull()
    expect(
      commandForEvent(
        key({ code: 'Equal', key: '+', ctrlKey: true, shiftKey: true }),
        commands,
      )?.id,
    ).toBe('zoom')
    dialog.remove()
  })
})
