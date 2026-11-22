import { describe, expect, test } from 'vitest'
import { formatSql } from './formatSql'

describe('formatSql', () => {
  test('formats a statement and keeps the case of the keywords', () => {
    expect(formatSql('SELECT a,b from t where x=1', 'postgres', 2)).toEqual({
      ok: true,
      text: 'SELECT\n  a,\n  b\nfrom\n  t\nwhere\n  x = 1',
    })
  })

  test('uses the tab width', () => {
    const result = formatSql('select a from t', 'postgres', 4)

    expect(result.ok && result.text).toBe('select\n    a\nfrom\n    t')
  })

  test('keeps the statements apart and a line feed at the end', () => {
    const result = formatSql('select 1;select 2;\n', 'postgres', 2)

    expect(result.ok && result.text).toBe('select\n  1;\n\nselect\n  2;\n')
  })

  test('reads the syntax of DuckDB', () => {
    const result = formatSql("from 'data.csv' select a", 'duckdb', 2)

    expect(result.ok && result.text).toContain("'data.csv'")
  })

  test('keeps dollar quotes and parameters of PostgreSQL', () => {
    const result = formatSql(
      'select $1, $$a;b$$ from t where id = $2',
      'postgres',
      2,
    )

    expect(result.ok && result.text).toContain('$$a;b$$')
    expect(result.ok && result.text).toContain('id = $2')
  })

  test('gives a message for SQL that the formatter cannot read', () => {
    const result = formatSql("select 'not closed", 'postgres', 2)

    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toMatch(/^The formatter cannot read/)
  })
})
