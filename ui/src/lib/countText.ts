const numberFormat = new Intl.NumberFormat('en-US')

/**
 * A number and its noun, in the singular for 1 and in the plural for all other
 * numbers. For example "1 row", "0 rows", or "1,250 rows".
 */
export function countText(
  value: number,
  noun: string,
  plural = `${noun}s`,
): string {
  return `${numberFormat.format(value)} ${value === 1 ? noun : plural}`
}
