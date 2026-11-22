import type { Command } from './commands'

/** The key name of the physical key, without the effect of Shift or Alt. */
function keyName(event: KeyboardEvent): string {
  const { code, key } = event
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  const symbols: Record<string, string> = {
    Equal: '=',
    Minus: '-',
    Comma: ',',
    NumpadAdd: '=',
    NumpadSubtract: '-',
  }
  return symbols[code] ?? (key.length === 1 ? key.toUpperCase() : key)
}

/** Writes a key event in the form of a shortcut, for example `Ctrl+Shift+N`. */
export function shortcutOf(event: KeyboardEvent): string {
  const parts = [
    event.ctrlKey || event.metaKey ? 'Ctrl' : null,
    event.shiftKey ? 'Shift' : null,
    event.altKey ? 'Alt' : null,
    keyName(event),
  ]
  return parts.filter(Boolean).join('+')
}

/** Puts the parts of a shortcut in the sequence of `shortcutOf`. */
function normalize(shortcut: string): string {
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1]
  const has = (name: string) => parts.slice(0, -1).includes(name)
  return [
    has('Ctrl') ? 'Ctrl' : null,
    has('Shift') ? 'Shift' : null,
    has('Alt') ? 'Alt' : null,
    key.length === 1 ? key.toUpperCase() : key,
  ]
    .filter(Boolean)
    .join('+')
}

/** Finds the command for a key event, or `null`. */
export function commandForEvent(
  event: KeyboardEvent,
  commands: Command[],
): Command | null {
  // `+` needs Shift on many keyboards. The zoom shortcut works with and without it.
  const pressed = shortcutOf(event).replace('Shift+=', '=')
  return (
    commands.find(
      (command) =>
        command.shortcut !== undefined &&
        normalize(command.shortcut) === pressed,
    ) ?? null
  )
}

/**
 * Runs the command of a key event. Returns `true` if a command ran.
 * A key that a different part handled, or a key in a dialog, does not run a command.
 */
export function handleShortcut(
  event: KeyboardEvent,
  commands: Command[],
): boolean {
  if (event.defaultPrevented || event.repeat) return false
  const target = event.target
  if (target instanceof Element && target.closest('[role="dialog"]'))
    return false
  const command = commandForEvent(event, commands)
  if (!command) return false
  event.preventDefault()
  if (command.isEnabled()) void command.run()
  return true
}
