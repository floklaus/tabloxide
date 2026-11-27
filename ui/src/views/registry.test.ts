import { expect, test } from 'vitest'
import { viewsFor } from './registry'

test('the grid is the first view of each result', () => {
  const views = viewsFor([{ name: 'n', type_name: null, kind: 'number' }])

  expect(views.map((view) => view.id)).toEqual(['grid', 'chart'])
})

test('a view with the score 0 is not available', () => {
  expect(viewsFor([]).map((view) => view.id)).toEqual(['grid'])
})
