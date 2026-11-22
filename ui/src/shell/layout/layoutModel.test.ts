import { describe, expect, test } from 'vitest'
import {
  BUILT_IN_LAYOUTS,
  describeSettings,
  moveToSlot,
  nameProblem,
  normalizeSettings,
  sameSettings,
  slotOf,
  STANDARD_SETTINGS,
  unusedName,
  type SavedLayout,
} from './layoutModel'

describe('normalizeSettings', () => {
  test('puts each value in its range and uses the standard value for a bad value', () => {
    const settings = normalizeSettings({
      sidebarWidth: 9000,
      editorSize: 3,
      resultsPosition: 'nowhere' as never,
      sidebarSide: 'top' as never,
      panels: { sidebar: false } as never,
    })

    expect(settings.sidebarWidth).toBe(480)
    expect(settings.editorSize).toBe(20)
    expect(settings.resultsPosition).toBe('below')
    expect(settings.sidebarSide).toBe('left')
    expect(settings.panels).toEqual({
      ...STANDARD_SETTINGS.panels,
      sidebar: false,
    })
    expect(normalizeSettings(undefined)).toEqual(STANDARD_SETTINGS)
  })
})

describe('moveToSlot', () => {
  test('moves each panel to a valid slot and shows a hidden panel', () => {
    const hidden = {
      ...STANDARD_SETTINGS,
      panels: { ...STANDARD_SETTINGS.panels, results: false },
    }

    const results = moveToSlot(hidden, 'results', 'beside')
    const sidebar = moveToSlot(STANDARD_SETTINGS, 'sidebar', 'right')
    const assistant = moveToSlot(STANDARD_SETTINGS, 'assistant', 'below-editor')

    expect(results.resultsPosition).toBe('beside')
    expect(results.panels.results).toBe(true)
    expect(slotOf(sidebar, 'sidebar')).toBe('right')
    expect(assistant.assistantPlacement).toBe('below-editor')
    expect(assistant.panels.assistant).toBe(true)
  })

  test('changes nothing for a slot that is not valid for the panel', () => {
    expect(moveToSlot(STANDARD_SETTINGS, 'sidebar', 'tab')).toBe(
      STANDARD_SETTINGS,
    )
  })
})

test('describeSettings tells what the layout shows', () => {
  expect(describeSettings(STANDARD_SETTINGS)).toBe(
    'Sidebar on the left, editor, results below the editor',
  )
  expect(describeSettings(BUILT_IN_LAYOUTS[1].settings)).toBe(
    'Editor, results below the editor',
  )
  expect(
    describeSettings({
      ...STANDARD_SETTINGS,
      resultsPosition: 'tab',
      assistantPlacement: 'below-editor',
      panels: { ...STANDARD_SETTINGS.panels, assistant: true, sidebar: false },
    }),
  ).toBe('Editor, results as a tab, assistant below the editor')
})

test('sameSettings compares the normalized values', () => {
  expect(sameSettings(STANDARD_SETTINGS, { ...STANDARD_SETTINGS })).toBe(true)
  expect(
    sameSettings(STANDARD_SETTINGS, {
      ...STANDARD_SETTINGS,
      sidebarWidth: 300,
    }),
  ).toBe(false)
})

describe('names', () => {
  const layouts: SavedLayout[] = [
    ...BUILT_IN_LAYOUTS,
    { id: 'c1', name: 'Review', settings: STANDARD_SETTINGS, isBuiltIn: false },
    {
      id: 'c2',
      name: 'Review 2',
      settings: STANDARD_SETTINGS,
      isBuiltIn: false,
    },
  ]

  test('unusedName adds a number to a name that exists', () => {
    expect(unusedName(layouts, 'Layout')).toBe('Layout')
    expect(unusedName(layouts, 'review')).toBe('review 3')
  })

  test('nameProblem rejects an empty, a long, or a used name', () => {
    expect(nameProblem(' ', layouts, null)).toBe('Enter a name.')
    expect(nameProblem('x'.repeat(41), layouts, null)).toMatch(/maximum/)
    expect(nameProblem('STANDARD', layouts, null)).toBe(
      'A layout with this name exists.',
    )
    // A layout can keep its own name.
    expect(nameProblem('Review', layouts, 'c1')).toBeNull()
    expect(nameProblem('Wide results', layouts, null)).toBeNull()
  })
})
