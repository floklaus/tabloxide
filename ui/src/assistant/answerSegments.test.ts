import { describe, expect, test } from 'vitest'
import { splitAnswer } from './answerSegments'

describe('splitAnswer', () => {
  test('returns the text and the code blocks in sequence', () => {
    const answer = [
      'This statement counts the rows.',
      '',
      '```sql',
      'SELECT count(*)',
      'FROM item;',
      '```',
      '',
      'It reads the full table.',
    ].join('\n')

    expect(splitAnswer(answer)).toEqual([
      { type: 'text', text: 'This statement counts the rows.' },
      {
        type: 'code',
        language: 'sql',
        code: 'SELECT count(*)\nFROM item;',
        isComplete: true,
      },
      { type: 'text', text: 'It reads the full table.' },
    ])
  })

  test('marks a code block without its closing fence as not complete', () => {
    expect(splitAnswer('Use this:\n```sql\nSELECT 1')).toEqual([
      { type: 'text', text: 'Use this:' },
      { type: 'code', language: 'sql', code: 'SELECT 1', isComplete: false },
    ])
  })

  test('accepts a code block without a language', () => {
    expect(splitAnswer('```\nSeq Scan on item\n```')).toEqual([
      {
        type: 'code',
        language: '',
        code: 'Seq Scan on item',
        isComplete: true,
      },
    ])
  })

  test('returns no segments for an empty answer', () => {
    expect(splitAnswer('  \n')).toEqual([])
  })
})
