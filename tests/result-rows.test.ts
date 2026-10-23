import { describe, expect, it } from 'vitest'
import { queryResultRows, sortResultRows } from '../src/result-rows'

const rows = [
  { label: '中国', value: 12 },
  { label: '美国', value: 30 },
  { label: 'China', value: 12 },
  { label: '日本', value: 5 },
]

describe('result table filtering', () => {
  it('keeps every row when the query is blank', () => {
    expect(queryResultRows(rows, '   ')).toEqual(rows)
  })

  it('matches group labels case-insensitively without changing values', () => {
    expect(queryResultRows(rows, 'chi').map(row => row.label)).toEqual(['China'])
    expect(queryResultRows(rows, 'CHINA').map(row => row.label)).toEqual(['China'])
    expect(queryResultRows(rows, '中国').map(row => row.label)).toEqual(['中国'])
    expect(queryResultRows(rows, '不存在')).toEqual([])
  })
})

describe('result table sorting', () => {
  it('does not mutate the calculation order', () => {
    const sorted = sortResultRows(rows, 'desc')
    expect(sorted.map(row => row.label)).toEqual(['美国', '中国', 'China', '日本'])
    expect(rows.map(row => row.label)).toEqual(['中国', '美国', 'China', '日本'])
  })

  it('sorts by value with a stable label tie-break', () => {
    expect(sortResultRows(rows, 'asc').map(row => row.value)).toEqual([5, 12, 12, 30])
    expect(sortResultRows(rows, 'desc').map(row => row.value)).toEqual([30, 12, 12, 5])
  })

  it('sorts labels with Chinese collation and keeps original order on demand', () => {
    expect(sortResultRows([{ label: 'beta', value: 1 }, { label: 'Alpha', value: 2 }], 'label').map(row => row.label)).toEqual(['Alpha', 'beta'])
    expect(sortResultRows(rows, 'original').map(row => row.label)).toEqual(rows.map(row => row.label))
  })

  it('places non-finite values after finite ones', () => {
    const mixed = [{ label: 'a', value: Number.NaN }, { label: 'b', value: 2 }]
    expect(sortResultRows(mixed, 'desc').map(row => row.label)).toEqual(['b', 'a'])
  })
})
