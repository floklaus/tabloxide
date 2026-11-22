import { completionKeymap } from '@codemirror/autocomplete'
import {
  defaultKeymap,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import type { KeyBinding } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { buildCommands } from '../shell/commands'
import {
  filterGroups,
  forPlatform,
  PART_SHORTCUTS,
  shortcutGroups,
} from './shortcutList'

/** The key maps that `CodeEditor` uses. */
const EDITOR_KEYS: KeyBinding[] = [
  ...completionKeymap,
  ...defaultKeymap,
  ...historyKeymap,
  ...searchKeymap,
  indentWithTab,
]

/** Writes a key of the help screen in the notation of CodeMirror on Linux. */
function codeMirrorKey(keys: string): string {
  return keys
    .replace(/^Ctrl\+(?=.$)/, 'Mod-')
    .replace(/^Ctrl\+(?!Space)/, 'Mod-')
    .replace(/\+/g, '-')
    .replace(/Up$/, 'ArrowUp')
    .replace(/Down$/, 'ArrowDown')
    .replace(/-([A-Z])$/, (_, letter: string) => `-${letter.toLowerCase()}`)
}

function editorHas(keys: string): boolean {
  const wanted = codeMirrorKey(keys)
  return EDITOR_KEYS.some((binding) => {
    const names = [binding.key, binding.linux, binding.win].filter(Boolean)
    // Some bindings name the Ctrl key directly, for example `Ctrl-Shift-z` on Linux.
    if (
      names.includes(wanted) ||
      names.includes(wanted.replace(/^Mod-/, 'Ctrl-'))
    ) {
      return true
    }
    // A binding with `shift` also handles the key with Shift.
    return (
      binding.shift !== undefined &&
      wanted.startsWith('Shift-') &&
      names.includes(wanted.slice('Shift-'.length))
    )
  })
}

describe('shortcutGroups', () => {
  const groups = shortcutGroups(buildCommands())
  const find = (title: string) => groups.find((group) => group.title === title)

  test('lists each command with a shortcut in the group of its menu', () => {
    expect(groups.map((group) => group.title)).toEqual([
      'File',
      'Run and edit SQL',
      'Connections',
      'Git',
      'View',
      'Help',
      'Editor',
      'Editor tabs',
      'Result grid',
      'Lists and menus',
      'Assistant',
    ])
    expect(find('View')?.shortcuts).toContainEqual({
      keys: ['Ctrl+K'],
      description: 'Search or run a command',
    })
    expect(find('Help')?.shortcuts).toEqual([
      { keys: ['F1'], description: 'Keyboard shortcuts' },
    ])
    expect(find('File')?.shortcuts).toContainEqual({
      keys: ['Ctrl+O'],
      description: 'Open file',
    })
  })

  test('each shortcut of a command is different', () => {
    const keys = buildCommands()
      .map((command) => command.shortcut)
      .filter(Boolean)

    expect(new Set(keys).size).toBe(keys.length)
  })

  test('each key of the editor exists in the key maps of the editor', () => {
    const editor = PART_SHORTCUTS.find((group) => group.title === 'Editor')
    const keys = editor?.shortcuts
      .filter((shortcut) => !shortcut.description.startsWith('Move the focus'))
      .flatMap((shortcut) => shortcut.keys)

    expect(keys?.length).toBeGreaterThan(5)
    for (const key of keys ?? []) {
      expect(editorHas(key), key).toBe(true)
    }
  })
})

test('filterGroups keeps the shortcuts that contain each word', () => {
  const groups = shortcutGroups(buildCommands())

  const found = filterGroups(groups, 'zoom ctrl')

  expect(found.map((group) => group.title)).toEqual(['View'])
  expect(found[0].shortcuts.map((shortcut) => shortcut.description)).toEqual([
    'Zoom in',
    'Zoom out',
    'Reset zoom',
  ])
  expect(filterGroups(groups, 'no such text')).toEqual([])
  expect(filterGroups(groups, ' ')).toBe(groups)
})

test('forPlatform writes Cmd for Ctrl on macOS', () => {
  expect(forPlatform('Ctrl+Shift+N', true)).toBe('Cmd+Shift+N')
  expect(forPlatform('Ctrl+Shift+N', false)).toBe('Ctrl+Shift+N')
  expect(forPlatform('F1', true)).toBe('F1')
})
