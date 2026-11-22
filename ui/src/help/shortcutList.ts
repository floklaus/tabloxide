import type { Command } from '../shell/commands'

/** One shortcut of the help screen. */
export type Shortcut = {
  /** The keys. Each entry is one key combination, for example `Ctrl+Shift+N`. */
  keys: string[]
  description: string
}

export type ShortcutGroup = { title: string; shortcuts: Shortcut[] }

/** The groups of the commands, in the sequence of the menu bar. */
const COMMAND_GROUPS: { group: Command['group']; title: string }[] = [
  { group: 'File', title: 'File' },
  { group: 'Query', title: 'Run and edit SQL' },
  { group: 'Connections', title: 'Connections' },
  { group: 'Git', title: 'Git' },
  { group: 'View', title: 'View' },
  { group: 'Help', title: 'Help' },
]

/**
 * The keys of the parts of the window. They are not commands of the menus, thus the
 * list has them here. A test compares the list of the editor with its key map.
 */
export const PART_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Editor',
    shortcuts: [
      { keys: ['Ctrl+Space'], description: 'Open the completion list.' },
      { keys: ['Ctrl+F'], description: 'Find text in the editor.' },
      {
        keys: ['F3', 'Shift+F3'],
        description: 'Go to the next or the previous match.',
      },
      { keys: ['Ctrl+/'], description: 'Comment or uncomment the lines.' },
      { keys: ['Ctrl+Z'], description: 'Undo.' },
      { keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], description: 'Redo.' },
      {
        keys: ['Tab', 'Shift+Tab'],
        description: 'Indent or outdent the lines.',
      },
      {
        keys: ['Alt+Up', 'Alt+Down'],
        description: 'Move the line up or down.',
      },
      {
        keys: ['Escape', 'Tab'],
        description:
          'Move the focus out of the editor. Press the two keys one after the other.',
      },
    ],
  },
  {
    title: 'Editor tabs',
    shortcuts: [
      {
        keys: ['Left', 'Right', 'Home', 'End'],
        description: 'Move to a different tab.',
      },
      { keys: ['Delete'], description: 'Close the tab.' },
    ],
  },
  {
    title: 'Result grid',
    shortcuts: [
      {
        keys: ['Arrow keys', 'Home', 'End', 'Page Up', 'Page Down'],
        description: 'Move the selected cell.',
      },
      { keys: ['Ctrl+C'], description: 'Copy the selected cell.' },
      {
        keys: ['Alt+Shift+Left', 'Alt+Shift+Right'],
        description: 'Change the width of the column of the selected cell.',
      },
    ],
  },
  {
    title: 'Lists and menus',
    shortcuts: [
      {
        keys: ['Arrow keys', 'Home', 'End'],
        description: 'Move in a menu, the file tree, or the command palette.',
      },
      {
        keys: ['Right', 'Left'],
        description: 'Open or close a submenu or a folder.',
      },
      { keys: ['Enter'], description: 'Run the selected item.' },
      {
        keys: ['>'],
        description: 'In the command palette: search only the commands.',
      },
      {
        keys: ['@'],
        description: 'In the command palette: search only the schema objects.',
      },
      {
        keys: ['Escape'],
        description: 'Close a menu, the palette, or a dialog.',
      },
    ],
  },
  {
    title: 'Assistant',
    shortcuts: [
      { keys: ['Enter'], description: 'Send the request.' },
      { keys: ['Shift+Enter'], description: 'Add a line to the request.' },
    ],
  },
]

/** Returns all shortcut groups: the commands with a shortcut, then the parts of the window. */
export function shortcutGroups(commands: Command[]): ShortcutGroup[] {
  const fromCommands = COMMAND_GROUPS.map(({ group, title }) => ({
    title,
    shortcuts: commands
      .filter((command) => command.group === group && command.shortcut)
      .map((command) => ({
        keys: [command.shortcut as string],
        description: command.label.replace(/…$/, ''),
      })),
  })).filter((group) => group.shortcuts.length > 0)
  return [...fromCommands, ...PART_SHORTCUTS]
}

/** Writes `Ctrl` as `Cmd` on macOS. */
export function forPlatform(keys: string, isMac: boolean): string {
  return isMac ? keys.replace(/\bCtrl\b/g, 'Cmd') : keys
}

/** Returns the groups with only the shortcuts that contain each word of `filter`. */
export function filterGroups(
  groups: ShortcutGroup[],
  filter: string,
): ShortcutGroup[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return groups
  return groups
    .map((group) => ({
      ...group,
      shortcuts: group.shortcuts.filter((shortcut) => {
        const text =
          `${group.title} ${shortcut.description} ${shortcut.keys.join(' ')}`.toLowerCase()
        return words.every((word) => text.includes(word))
      }),
    }))
    .filter((group) => group.shortcuts.length > 0)
}
