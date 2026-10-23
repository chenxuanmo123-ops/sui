import type { ConsoleRow } from './sql-console'

export type SqlChartSpec = { x: number; y: number; kind: 'bar' | 'line' }
// x = -1 means the row position in the query result, used when no column is a
// sensible label axis. y = -1 means no numeric column exists.
export type SqlChartDefaults = { x: number; y: number; kind: 'bar' | 'line' }

const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

// Same strictness as the SQL strict_number UDF: thousands separators, currency
// symbols and percentages are not silently treated as numbers.
export function numericCell(value: string | number | null): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !NUMERIC.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function numericColumn(index: number, rows: ConsoleRow[]) {
  const values = rows.map(row => row[index]).filter(value => value !== null && value !== '')
  return values.length > 0 && values.every(value => numericCell(value) !== null)
}

export function numericColumns(columns: string[], rows: ConsoleRow[]) {
  return columns.map((_, index) => numericColumn(index, rows) ? index : -1).filter(index => index >= 0)
}

export function sqlChartDefaults(columns: string[], rows: ConsoleRow[]): SqlChartDefaults {
  const numeric = numericColumns(columns, rows)
  const label = columns.findIndex((_, index) => !numeric.includes(index))
  const y = numeric.find(index => index !== label) ?? numeric[0] ?? -1
  // Prefer a real label column; otherwise plot against the result row order.
  const x = label >= 0 ? label : y >= 0 && numeric.length > 1 ? numeric.find(index => index !== y)! : -1
  return { x, y, kind: 'bar' }
}

export function sqlChartSeries(spec: SqlChartSpec, rows: ConsoleRow[]) {
  const labels = rows.map((row, index) => spec.x >= 0 ? String(row[spec.x] ?? '（空）') : '第 ' + (index + 1) + ' 行')
  const values = rows.map(row => spec.y >= 0 ? numericCell(row[spec.y]) : null)
  return { labels, values }
}
