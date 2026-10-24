import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCSV } from '../src/data'
import type { Analysis, Dataset, Mapping } from '../src/data'
import { buildCheckup } from '../src/checkup'
import type { Checkup, CheckupField } from '../src/checkup'
import { buildNextCuts } from '../src/next-cuts'

const uci: Dataset = {
  ...parseCSV(readFileSync(resolve('tests/fixtures/uci-online-shoppers.csv'), 'utf8')),
  title: 'UCI 在线购物会话', sourceUrl: 'https://archive.ics.uci.edu/dataset/468/online+shoppers+purchasing+intention+dataset', loadedAt: '2026-10-15', fingerprint: 'next-cuts-uci', isPublic: false,
}
const owid: Dataset = {
  ...parseCSV(readFileSync(resolve('tests/fixtures/owid-China-2015-2022.csv'), 'utf8')),
  title: 'OWID 真实中国年度子集', sourceUrl: 'https://github.com/owid/energy-data', loadedAt: '2026-10-15', fingerprint: 'next-cuts-owid', isPublic: false,
}
function base(overrides: Partial<Mapping>): Mapping {
  return { x: '', metric: '', filter: '', value: '', from: '', to: '', unit: '', aggregate: 'sum', timeBucket: 'none', conditions: [], ...overrides }
}
function result(mapping: Mapping): Analysis {
  return {
    id: 1, question: '换维度', mapping, points: [{ label: 'a', value: 1, rowIds: [2] }],
    usedRows: 1, skipped: 0, matched: 1, createdAt: '2026-10-15T00:00:00.000Z', datasetHash: 'manual',
    finding: '测试', operations: [],
  }
}
function field(overrides: Partial<CheckupField>): CheckupField {
  return { key: '', role: 'category', roleLabel: '', detail: '', missing: 0, nonempty: 10, unique: 2, numeric: 0, top: [], min: null, max: null, median: null, outliers: 0, ...overrides }
}
function checkup(overrides: Partial<Checkup>): Checkup {
  return { rows: 10, fields: 1, completeness: 1, missingCells: 0, duplicateRows: 0, timeField: null, measures: [], categories: [], binaries: [], identifiers: [], highCardinality: [], all: [], warnings: [], questions: [], summary: '', ...overrides }
}

describe('换维度：只改分组字段，指标与口径保持不变', () => {
  it('UCI 结果把时间字段和真实分类列作为候选，且不重复当前分组/指标/筛选字段', () => {
    const data = buildCheckup(uci)
    const mapping = base({ x: 'Month', metric: 'BounceRates', filter: '', unit: '%', aggregate: 'average' })
    const cuts = buildNextCuts(result(mapping), data)
    expect(cuts.length).toBeGreaterThan(0)
    expect(cuts.length).toBeLessThanOrEqual(3)
    if (data.timeField) expect(cuts[0].kind).toBe('time')
    for (const cut of cuts) {
      expect(cut.mapping.metric).toBe('BounceRates')
      expect(cut.mapping.aggregate).toBe('average')
      expect(cut.mapping.unit).toBe('%')
      expect(cut.mapping.x).not.toBe('Month')
      expect(cut.mapping.x).not.toBe('BounceRates')
      expect(cut.mapping).not.toBe(mapping)
    }
  })

  it('年度时间字段按原值分组，不强行做月桶', () => {
    const data = buildCheckup(owid)
    const cuts = buildNextCuts(result(base({ x: 'country', metric: 'renewables_electricity', unit: 'TWh' })), data)
    const timeCut = cuts.find(cut => cut.kind === 'time')
    expect(timeCut?.mapping).toMatchObject({ x: 'year', timeBucket: 'none', metric: 'renewables_electricity', unit: 'TWh' })
  })

  it('已是时间分组或该字段正被筛选时不再重复推荐', () => {
    const date = field({ key: 'date', role: 'time', time: { granularity: 'date', valid: 10, distinct: 10, min: '2023-01-01', max: '2023-03-01', gaps: 0 } })
    const onlyTime = checkup({ timeField: date })
    expect(buildNextCuts(result(base({ x: 'date', metric: 'amount', unit: '元' })), onlyTime)).toEqual([])

    const withChannel = checkup({ timeField: date, categories: [field({ key: 'channel', unique: 3 })] })
    expect(buildNextCuts(result(base({ x: 'channel', metric: 'amount', filter: 'date', value: '2023-01-01', unit: '元' })), withChannel)).toEqual([])
  })

  it('不超过三年跨度的日期按月分组，更长的跨度按年分组', () => {
    const short = checkup({ timeField: field({ key: 'date', role: 'time', time: { granularity: 'date', valid: 10, distinct: 10, min: '2023-01-01', max: '2024-12-31', gaps: 0 } }) })
    const long = checkup({ timeField: field({ key: 'date', role: 'time', time: { granularity: 'date', valid: 10, distinct: 10, min: '2015-01-01', max: '2024-12-31', gaps: 0 } }) })
    const mapping = base({ x: 'channel', metric: 'amount', unit: '元' })
    expect(buildNextCuts(result(mapping), short)[0].mapping.timeBucket).toBe('month')
    expect(buildNextCuts(result(mapping), long)[0].mapping.timeBucket).toBe('year')
  })

  it('高基数、单值和受限数量都被处理', () => {
    const data = checkup({ categories: [field({ key: 'tiny', unique: 1 }), field({ key: 'many', unique: 400 }), field({ key: 'region', unique: 5 }), field({ key: 'device', unique: 2 })] })
    const cuts = buildNextCuts(result(base({ x: 'year', metric: 'sales', unit: '元' })), data, 1)
    expect(cuts).toHaveLength(1)
    expect(cuts[0].mapping.x).toBe('device')
  })
})
