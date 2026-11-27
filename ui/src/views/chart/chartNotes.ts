import { OTHER_NAME, type ChartNote } from './chartModel'

export class Notes {
  private readonly counts = new Map<string, ChartNote>()

  count(
    note: Extract<
      ChartNote,
      {
        id:
          | 'not-numbers'
          | 'not-times'
          | 'empty-x'
          | 'duplicates'
          | 'not-positive'
          | 'incomplete-rows'
      }
    >,
  ): void {
    if (note.count === 0) return
    const key = 'column' in note ? `${note.id}:${note.column}` : note.id
    const found = this.counts.get(key)
    if (found && 'count' in found) found.count += note.count
    else this.counts.set(key, { ...note })
  }

  add(note: ChartNote): void {
    this.counts.set(note.id, note)
  }

  list(): ChartNote[] {
    return [...this.counts.values()]
  }
}

const count = new Intl.NumberFormat('en-US')

function cells(value: number): string {
  return value === 1 ? '1 cell' : `${count.format(value)} cells`
}

function rowsText(value: number): string {
  return value === 1 ? '1 row' : `${count.format(value)} rows`
}

/** The sentence that the chart view shows for a note. */
export function noteText(note: ChartNote): string {
  switch (note.id) {
    case 'not-numbers':
      return `${cells(note.count)} of the column ${note.column} ${note.count === 1 ? 'is' : 'are'} not a number. The chart does not show ${note.count === 1 ? 'it' : 'them'}.`
    case 'not-times':
      return `${cells(note.count)} of the column ${note.column} ${note.count === 1 ? 'is' : 'are'} not a date. The chart does not show ${note.count === 1 ? 'it' : 'them'}.`
    case 'empty-x':
      return `${rowsText(note.count)} ${note.count === 1 ? 'has' : 'have'} no value for the horizontal axis. The chart does not show ${note.count === 1 ? 'it' : 'them'}.`
    case 'series-limit':
      return `The chart shows the first ${note.shown} of ${count.format(note.total)} series.${note.hasOther ? ` The series "${OTHER_NAME}" has the rest.` : ''}`
    case 'category-limit':
      return `The chart shows the first ${note.shown} of ${count.format(note.total)} categories.${note.hasOther ? ` The category "${OTHER_NAME}" has the rest.` : ''}`
    case 'duplicates':
      return `${cells(note.count)} ${note.count === 1 ? 'has' : 'have'} the same horizontal value and the same series as an earlier row. The chart does not show ${note.count === 1 ? 'it' : 'them'}. Select an aggregate to combine such rows.`
    case 'not-positive':
      return `${count.format(note.count)} ${note.count === 1 ? 'value is' : 'values are'} zero or negative. A logarithmic axis cannot show ${note.count === 1 ? 'it' : 'them'}.`
    case 'point-limit':
      return `The chart shows the first ${count.format(note.shown)} of ${count.format(note.total)} marks. More marks make the chart too slow.`
    case 'year-limit':
      return `The calendar shows the last ${note.shown} of ${note.total} years.`
    case 'incomplete-rows':
      return `${rowsText(note.count)} ${note.count === 1 ? 'has' : 'have'} an empty value or a value that is not a number. The chart does not show ${note.count === 1 ? 'it' : 'them'}.`
    case 'cycle':
      return 'The links go in a circle. A Sankey diagram can show only links that go in one direction.'
    case 'first-row':
      return `The result has ${rowsText(note.rows)}. The view shows the value of the first row. Select an aggregate to combine the rows.`
  }
}
