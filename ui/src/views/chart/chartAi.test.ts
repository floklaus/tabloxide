import { describe, expect, test } from 'vitest'
import { chartOfAnswer, proposeChartRequest } from './chartAi'
import { column } from './testColumns'

const COLUMNS = [
  { name: 'day', type_name: 'timestamptz', kind: 'temporal' as const },
  column('country', 'text'),
  column('amount', 'number'),
]

function answer(json: string): string {
  return `The chart shows the amount of each month.\n\n\`\`\`json\n${json}\n\`\`\`\n`
}

describe('proposeChartRequest', () => {
  test('sends the name, the kind, and the type name of each column, and no rows', () => {
    const request = proposeChartRequest(COLUMNS, '  The revenue by month  ')

    expect(request).toEqual({
      task: 'chart',
      text: 'The revenue by month',
      context: {
        type: 'result-columns',
        columns: [
          { name: 'day', type_name: 'timestamptz', kind: 'temporal' },
          { name: 'country', type_name: null, kind: 'text' },
          { name: 'amount', type_name: null, kind: 'number' },
        ],
      },
    })
  })

  test('without a question, the request asks for the most useful chart', () => {
    expect(proposeChartRequest(COLUMNS, ' ').text).toBe(
      'Propose the most useful chart for this result.',
    )
  })
})

describe('chartOfAnswer', () => {
  test('reads the settings from the one code block of the answer', () => {
    const result = chartOfAnswer(
      answer(
        '{"type": "line", "x": "day", "y": ["amount"], "timeUnit": "month", "series": "country"}',
      ),
      COLUMNS,
    )

    expect(result).toEqual({
      settings: {
        type: 'line',
        x: 'day',
        y: ['amount'],
        series: 'country',
        timeUnit: 'month',
      },
    })
  })

  test('refuses an answer with a column that the result does not have', () => {
    const result = chartOfAnswer(
      answer('{"type": "bar", "x": "region", "y": ["amount"]}'),
      COLUMNS,
    )

    expect(result).toEqual({
      error:
        'The answer uses the column region. The result does not have this column.',
    })
  })

  test('refuses an answer without a code block, and an answer with two code blocks', () => {
    const none = chartOfAnswer('Use a line chart.', COLUMNS)
    const two = chartOfAnswer(
      `${answer('{"type": "bar", "y": []}')}${answer('{"type": "line", "y": []}')}`,
      COLUMNS,
    )

    expect(none).toEqual({
      error: 'The answer has no chart settings in one code block.',
    })
    expect(two).toEqual(none)
  })

  test('refuses text that is not JSON', () => {
    expect(chartOfAnswer(answer('type: bar'), COLUMNS)).toEqual({
      error: 'The chart settings of the answer are not valid JSON.',
    })
  })

  test('refuses settings that the application does not know', () => {
    expect(
      chartOfAnswer(answer('{"type": "gantt", "x": "day"}'), COLUMNS),
    ).toEqual({ error: 'The chart type "gantt" is not known.' })
  })

  test('refuses settings that are not complete', () => {
    expect(
      chartOfAnswer(
        answer('{"type": "heatmap", "x": "country", "y": ["amount"]}'),
        COLUMNS,
      ),
    ).toEqual({
      error:
        'The chart settings of the answer are not complete. Select the column for "Rows".',
    })
  })

  test('removes the parts that the chart type does not use', () => {
    const result = chartOfAnswer(
      answer(
        '{"type": "histogram", "x": "amount", "y": [], "stacked": true, "series": "country"}',
      ),
      COLUMNS,
    )

    expect(result).toEqual({
      settings: { type: 'histogram', x: 'amount', y: [] },
    })
  })
})
