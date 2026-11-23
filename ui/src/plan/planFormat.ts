import type { PlanNode } from './planModel'

export const numbers = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
})

export const percent = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 0,
})

export function milliseconds(value: number): string {
  return value < 1000
    ? `${numbers.format(value)} ms`
    : `${numbers.format(value / 1000)} s`
}

export function measureText(
  node: PlanNode,
  isAnalyzed: boolean,
): string | null {
  if (isAnalyzed && node.selfTime !== null) return milliseconds(node.selfTime)
  if (node.selfCost !== null) return `cost ${numbers.format(node.selfCost)}`
  return null
}

export function rowsText(node: PlanNode): string | null {
  const parts = [
    node.estimatedRows === null
      ? null
      : `${numbers.format(node.estimatedRows)} expected`,
    node.actualRows === null
      ? null
      : `${numbers.format(node.actualRows)} actual`,
  ].filter(Boolean)
  return parts.length > 0 ? `rows: ${parts.join(', ')}` : null
}

export function misestimateText(factor: number): string {
  return factor > 0
    ? `${factor} times more rows than expected`
    : `${-factor} times fewer rows than expected`
}

const rows = (value: number) =>
  `${numbers.format(value)} ${value === 1 ? 'row' : 'rows'}`

/** The numbers of a step in sentences, for example "The planner expected 10 rows." */
export function numbersSentence(node: PlanNode, isAnalyzed: boolean): string {
  const parts: string[] = []
  if (node.estimatedRows !== null) {
    parts.push(`The planner expected ${rows(node.estimatedRows)}.`)
  }
  if (node.actualRows !== null) {
    parts.push(
      node.loops !== null && node.loops > 1
        ? `The step ran ${numbers.format(node.loops)} times and returned ${rows(node.actualRows)} on average each time.`
        : `The step returned ${rows(node.actualRows)}.`,
    )
  }
  if (isAnalyzed && node.selfTime !== null) {
    parts.push(
      `It took ${milliseconds(node.selfTime)}, without the time of its child steps.`,
    )
  } else if (node.selfCost !== null) {
    parts.push(
      `Its own estimated cost is ${numbers.format(node.selfCost)}, without its child steps.`,
    )
  }
  return parts.join(' ')
}
