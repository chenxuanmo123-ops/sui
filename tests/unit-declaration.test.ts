import { describe, expect, it } from 'vitest'
import { normalizeUnit, summarize, withDeclaredUnit } from '../src/data'
import type { Analysis } from '../src/data'

const points = [
  { label: '2020', value: 120, rowIds: [2, 3] },
  { label: '2021', value: 134, rowIds: [4] },
]
const trend = { n: 2, slope: 14, intercept: 106, r2: 1, period: 'year' as const }
const base: Analysis = {
  id: 7,
  question: '逐年销售额',
  mapping: { x: 'period', metric: 'sales', filter: '', value: '', from: '', to: '', unit: '', aggregate: 'sum' },
  points,
  usedRows: 3,
  skipped: 0,
  matched: 3,
  createdAt: '2026-10-25T00:00:00.000Z',
  datasetHash: 'a'.repeat(64),
  finding: summarize(points, '', true),
  operations: ['SQLite / sql.js 真实执行参数化只读查询'],
  sql: 'SELECT label, SUM(raw_value) FROM selected GROUP BY label',
  parameters: [],
  trend,
}

describe('声明指标单位：只改标注，不改计算', () => {
  it('记录用户声明的单位，并让确定性结论与导出使用同一标注', () => {
    const next = withDeclaredUnit(base, '  亿元  ')
    expect(next).not.toBe(base)
    expect(next.mapping.unit).toBe('亿元')
    expect(next.unitSource).toBe('user')
    expect(next.finding).toContain('亿元')
    expect(next.finding).toContain('120')
    expect(next.finding).toContain('134')
    expect(next.points).toBe(base.points)
    expect(next.sql).toBe(base.sql)
    expect(next.parameters).toBe(base.parameters)
    expect(next.usedRows).toBe(3)
    expect(base.mapping.unit).toBe('')
  })

  it('单位长度受限，空白输入表示撤回声明', () => {
    expect(normalizeUnit('  TWh  ')).toBe('TWh')
    expect(normalizeUnit('x'.repeat(45))).toHaveLength(40)
    const cleared = withDeclaredUnit(withDeclaredUnit(base, '亿元'), '   ')
    expect(cleared.mapping.unit).toBe('')
    expect(cleared.unitSource).toBeUndefined()
    expect(cleared.finding).not.toContain('亿元')
  })

  it('分组追问的来源基线同步单位，但保留原值', () => {
    const scoped: Analysis = {
      ...base,
      scope: {
        datasetHash: base.datasetHash,
        loadedAt: base.createdAt,
        parentAnalysisId: 3,
        parentTitle: '原分析',
        label: '2020',
        rowIds: [2, 3],
        baseline: { metric: 'sales', aggregate: 'sum', unit: '', value: 120 },
      },
    }
    const next = withDeclaredUnit(scoped, '亿元')
    expect(next.scope?.baseline.unit).toBe('亿元')
    expect(next.scope?.baseline.value).toBe(120)
    expect(next.scope?.rowIds).toEqual([2, 3])
  })

  it('条件比例的单位固定为 %，不会被单位声明改写', () => {
    const rate: Analysis = {
      ...base,
      mapping: { ...base.mapping, unit: '%', rate: { successValue: '是', eligibleValues: ['是', '否'] } },
      finding: '当前范围总体比例 50%。',
    }
    expect(withDeclaredUnit(rate, '次')).toBe(rate)
  })

  it('重复声明同一单位不产生新结果', () => {
    const declared = withDeclaredUnit(base, '亿元')
    expect(withDeclaredUnit(declared, '亿元')).toBe(declared)
  })

  it('分析计划自带的单位不算用户声明，确认同一单位后才标记为用户声明', () => {
    const planned: Analysis = {
      ...base,
      mapping: { ...base.mapping, unit: 'TWh' },
      finding: summarize(points, 'TWh', true),
    }
    expect(planned.unitSource).toBeUndefined()
    const confirmed = withDeclaredUnit(planned, 'TWh')
    expect(confirmed).not.toBe(planned)
    expect(confirmed.mapping.unit).toBe('TWh')
    expect(confirmed.unitSource).toBe('user')
    expect(confirmed.finding).toBe(planned.finding)
    expect(confirmed.points).toBe(planned.points)
  })
})
