import { CompletionContext } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { expect, test } from 'vitest'
import { combineSources } from './combine'

const context = new CompletionContext(
  EditorState.create({ doc: 'select it' }),
  9,
  false,
)

test('joins the options of the sources with the same start', async () => {
  const combined = combineSources(
    async () => ({ from: 7, options: [{ label: 'item' }], validFor: /^\w*$/ }),
    async () => null,
    async () => ({ from: 7, options: [{ label: 'insert' }] }),
    async () => ({ from: 3, options: [{ label: 'other start' }] }),
  )

  const result = await combined(context)

  expect(result?.from).toBe(7)
  expect(result?.options.map((option) => option.label)).toEqual([
    'item',
    'insert',
  ])
})

test('keeps the result of one source as it is', async () => {
  const validFor = /^\w*$/
  const combined = combineSources(async () => ({
    from: 7,
    options: [],
    validFor,
  }))

  expect((await combined(context))?.validFor).toBe(validFor)
  expect(await combineSources(async () => null)(context)).toBeNull()
})
