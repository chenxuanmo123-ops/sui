import type { Dataset } from './data'

// SQLite identifiers are case-insensitive. If the uploaded headers are not
// case-insensitively unique, or collide with the provenance column, expose cN
// names instead so the view cannot merge or reject columns.
export function recordColumnName(dataset: Dataset) {
  const lower = new Set(dataset.headers.map(h => h.toLowerCase()))
  let name = '__record__'
  while (lower.has(name.toLowerCase())) name += '_'
  return name
}

export function exportColumnNames(dataset: { headers: string[] }, recordName: string) {
  const lower = dataset.headers.map(h => h.toLowerCase())
  const readable = new Set(lower).size === lower.length && !lower.includes(recordName.toLowerCase())
  return readable ? dataset.headers.slice() : dataset.headers.map((_, i) => 'c' + i)
}
