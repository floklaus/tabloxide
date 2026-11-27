import { describe, expect, test } from 'vitest'
import {
  parseViewFile,
  savedViewsOf,
  serializeViewFile,
  viewFilePath,
  withoutSavedView,
  withSavedView,
  type SavedView,
  type ViewFile,
} from './viewFile'

const REVENUE: SavedView = {
  name: 'Revenue by day',
  statement: 1,
  view: 'chart',
  settings: { type: 'line', x: 'day', y: ['amount'], series: 'kind' },
}
const FILE: ViewFile = { version: 1, views: [REVENUE] }

describe('viewFilePath', () => {
  test.each([
    ['revenue.sql', 'revenue.view.json'],
    ['reports/2026/revenue.sql', 'reports/2026/revenue.view.json'],
    ['films.mongodb.js', 'films.mongodb.view.json'],
    ['notes', 'notes.view.json'],
    ['dir.v2/notes', 'dir.v2/notes.view.json'],
    ['.hidden', '.hidden.view.json'],
  ])('the view file of %s is %s', (query, expected) => {
    expect(viewFilePath(query)).toBe(expected)
  })
})

describe('parseViewFile', () => {
  test('reads the example of the design document', () => {
    const parsed = parseViewFile(serializeViewFile(FILE))

    expect(parsed).toEqual({ file: FILE })
  })

  test.each([
    ['{', 'not valid JSON'],
    ['[]', 'not a JSON object'],
    ['{"version": 2, "views": []}', 'the version 2'],
    ['{"views": []}', 'the version undefined'],
    ['{"version": 1}', 'no list "views"'],
    ['{"version": 1, "views": [{"name": "a"}]}', 'The view 1 of the file'],
    [
      '{"version": 1, "views": [{"name": "a", "statement": 0, "view": "chart", "settings": {}}]}',
      'The view 1 of the file',
    ],
  ])('refuses %s', (text, part) => {
    const parsed = parseViewFile(text)

    expect('error' in parsed && parsed.error).toContain(part)
  })

  test('keeps the parts that it does not know', () => {
    const text =
      '{"version": 1, "note": "x", "views": [{"name": "a", "statement": 1, "view": "map", "settings": {}, "pinned": true}]}'

    const parsed = parseViewFile(text)

    expect(parsed).toMatchObject({
      file: { note: 'x', views: [{ view: 'map', pinned: true }] },
    })
  })
})

test('serializeViewFile writes each setting on its own line and ends with a line end', () => {
  const text = serializeViewFile(FILE)

  expect(text).toContain('\n      "name": "Revenue by day",\n')
  expect(text).toContain('\n        "type": "line",\n')
  expect(text.endsWith('}\n')).toBe(true)
})

describe('the saved views of a statement', () => {
  const second: SavedView = { ...REVENUE, name: 'Other', statement: 2 }
  const map: SavedView = { ...REVENUE, name: 'Map', view: 'map' }
  const file: ViewFile = { version: 1, views: [REVENUE, second, map] }

  test('savedViewsOf gives the views of the statement for the view', () => {
    expect(savedViewsOf(file, 1, 'chart')).toEqual([REVENUE])
  })

  test('withSavedView replaces the view with the same name at its position', () => {
    const changed = { ...REVENUE, settings: { type: 'bar', y: [] } }

    const result = withSavedView(file, changed)

    expect(result.views).toEqual([changed, second, map])
  })

  test('withSavedView adds a view with a new name to the end', () => {
    const added = { ...REVENUE, name: 'Revenue by week' }

    const result = withSavedView(file, added)

    expect(result.views).toEqual([REVENUE, second, map, added])
  })

  test('withSavedView does not change the file that it gets', () => {
    withSavedView(file, { ...REVENUE, name: 'New' })

    expect(file.views).toHaveLength(3)
  })

  test('withoutSavedView removes only the view of the statement with the name', () => {
    const sameName: SavedView = { ...REVENUE, statement: 2 }
    const both: ViewFile = { version: 1, views: [REVENUE, sameName] }

    const result = withoutSavedView(both, 1, REVENUE.name)

    expect(result.views).toEqual([sameName])
  })
})
