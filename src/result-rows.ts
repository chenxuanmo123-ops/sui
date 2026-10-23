export type ResultSort = 'original' | 'label' | 'desc' | 'asc'

// Result tables keep the calculation order until the reader asks for another one.
// Filtering and sorting never change the numbers, only which rows are shown.
export function queryResultRows<T extends { label: string }>(rows: T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase('zh-CN')
  if (!needle) return rows
  return rows.filter(row => row.label.toLocaleLowerCase('zh-CN').includes(needle))
}

export function sortResultRows<T extends { label: string; value: number }>(rows: T[], sort: ResultSort): T[] {
  if (sort === 'original') return rows.slice()
  const copy = rows.slice()
  if (sort === 'label') return copy.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  const direction = sort === 'desc' ? -1 : 1
  return copy.sort((a, b) => {
    const aValid = Number.isFinite(a.value), bValid = Number.isFinite(b.value)
    if (!aValid || !bValid) return aValid ? -1 : bValid ? 1 : a.label.localeCompare(b.label, 'zh-CN')
    return a.value === b.value ? a.label.localeCompare(b.label, 'zh-CN') : direction * (a.value - b.value)
  })
}
