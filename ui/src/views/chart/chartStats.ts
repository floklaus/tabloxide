import type { Aggregate } from './chartSettings'

export type Accumulator = {
  sum: number
  count: number
  min: number
  max: number
}

export function newAccumulator(): Accumulator {
  return { sum: 0, count: 0, min: Infinity, max: -Infinity }
}

export function accumulate(target: Accumulator, value: number): void {
  target.sum += value
  target.count += 1
  target.min = Math.min(target.min, value)
  target.max = Math.max(target.max, value)
}

export function result(
  target: Accumulator,
  aggregate: Aggregate,
): number | null {
  if (aggregate === 'count') return target.count
  if (target.count === 0) return null
  if (aggregate === 'sum') return target.sum
  if (aggregate === 'mean') return target.sum / target.count
  return aggregate === 'min' ? target.min : target.max
}

export function merge(
  cells: (Accumulator | undefined)[],
): Accumulator | undefined {
  let total: Accumulator | undefined
  for (const cell of cells) {
    if (!cell) continue
    total ??= newAccumulator()
    total.sum += cell.sum
    total.count += cell.count
    total.min = Math.min(total.min, cell.min)
    total.max = Math.max(total.max, cell.max)
  }
  return total
}
