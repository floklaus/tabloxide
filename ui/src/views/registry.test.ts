import { expect, test } from 'vitest'
import { viewsFor } from './registry'

test('the grid is the first view of each result', () => {
  const views = viewsFor([{ name: 'n', type_name: null, kind: 'number' }])

  expect(views.map((view) => view.id)).toEqual(['grid', 'chart', 'profile'])
})

test('a view with the score 0 is not available', () => {
  expect(viewsFor([]).map((view) => view.id)).toEqual(['grid'])
})

test('the chart is before the profile, also for a result without a proposed chart', () => {
  const views = viewsFor([{ name: 'document', type_name: null, kind: 'json' }])

  expect(views.map((view) => view.id)).toEqual(['grid', 'chart', 'profile'])
})
