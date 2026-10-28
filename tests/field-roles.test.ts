import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCSV } from '../src/data'
import type { Analysis, Dataset, Mapping } from '../src/data'
import { buildCheckup, roleOptions } from '../src/checkup'
import { buildNextCuts } from '../src/next-cuts'

const uci: Dataset = {
  ...parseCSV(readFileSync(resolve('tests/fixtures/uci-online-shoppers.csv'), 'utf8')),
  title: 'UCI 在线购物会话', sourceUrl: 'https://archive.ics.uci.edu/dataset/468/online+shoppers+purchasing+intention+dataset', loadedAt: '2026-10-15', fingerprint: 'field-roles-uci', isPublic: false,
}

function synthetic(headers: string[], rows: string[][]): Dataset {
  return {
    headers,
    rows: rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))),
    title: '测试数据', sourceUrl: '', loadedAt: '2026-10-15', fingerprint: 'f'.repeat(64), isPublic: false,
  }
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

describe('字段角色手动纠正：只在数据支持时生效', () => {
  it('把自动判为数值的多取值整数列改成分类维度，计数与建议随之变化', () => {
    const auto = buildCheckup(uci)
    const before = auto.all.find(field => field.key === 'Administrative')!
    expect(before.role).toBe('measure')

    const corrected = buildCheckup(uci, { Administrative: 'category' })
    const after = corrected.all.find(field => field.key === 'Administrative')!
    expect(after.role).toBe('category')
    expect(after.overridden).toBe(true)
    expect(after.autoRoleLabel).toBe('数值指标')
    expect(corrected.measures.some(field => field.key === 'Administrative')).toBe(false)
    expect(corrected.categories.some(field => field.key === 'Administrative')).toBe(true)
    expect(corrected.measures.length).toBe(auto.measures.length - 1)
    expect(corrected.categories.length).toBe(auto.categories.length + 1)
  })

  it('把小整数编码列改成数值指标', () => {
    const auto = buildCheckup(uci)
    expect(auto.all.find(field => field.key === 'Browser')!.role).toBe('category')
    const corrected = buildCheckup(uci, { Browser: 'measure' })
    expect(corrected.all.find(field => field.key === 'Browser')!.role).toBe('measure')
    expect(corrected.measures.some(field => field.key === 'Browser')).toBe(true)
  })

  it('无法解析为数值的文本列，即使声明为指标也保持自动判断', () => {
    const corrected = buildCheckup(uci, { VisitorType: 'measure' })
    const field = corrected.all.find(item => item.key === 'VisitorType')!
    expect(field.role).toBe('category')
    expect(field.overridden).toBeUndefined()
    const measure = roleOptions(uci, field).find(option => option.role === 'measure')!
    expect(measure.enabled).toBe(false)
    expect(measure.reason).toContain('仅 0%')
  })

  it('用户明确声明年份列后，裸四位数可按年分组', () => {
    const rows = Array.from({ length: 8 }, (_, index) => [String(2015 + index), String(100 + index)])
    const data = synthetic(['period', 'sales'], rows)
    const auto = buildCheckup(data)
    expect(auto.all.find(field => field.key === 'period')!.role).not.toBe('time')
    const corrected = buildCheckup(data, { period: 'time' })
    const field = corrected.all.find(item => item.key === 'period')!
    expect(field.role).toBe('time')
    expect(field.overridden).toBe(true)
    expect(field.autoRoleLabel).toBe('分类维度')
    expect(field.time).toMatchObject({ granularity: 'year', min: '2015', max: '2022' })
    expect(corrected.timeField?.key).toBe('period')
    expect(corrected.questions.some(question => question.id.startsWith('trend:period:'))).toBe(true)
  })

  it('不能辨认成功值的两值列不能改成二值结果，超过 1000 组的列不能改成分类', () => {
    const flags = synthetic(['flag'], [['A'], ['B'], ['A'], ['B']])
    const flag = buildCheckup(flags).all[0]
    const binary = roleOptions(flags, flag).find(option => option.role === 'binary')!
    expect(binary.enabled).toBe(false)
    expect(binary.reason).toContain('无法辨认')

    const wide = synthetic(['code'], Array.from({ length: 1001 }, (_, index) => ['C' + index]))
    const code = buildCheckup(wide).all[0]
    const category = roleOptions(wide, code).find(option => option.role === 'category')!
    expect(category.enabled).toBe(false)
    expect(category.reason).toContain('1000')
    expect(buildCheckup(wide, { code: 'category' }).all[0].role).not.toBe('category')
  })

  it('未知字段或旧工作区里的无效纠正被忽略，不报错', () => {
    const auto = buildCheckup(uci)
    const corrected = buildCheckup(uci, { '不存在的字段': 'measure', Month: 'measure' })
    expect(corrected.all.map(field => field.key)).toEqual(auto.all.map(field => field.key))
    expect(corrected.all.find(field => field.key === 'Month')!.role).toBe('category')
  })

  it('纠正后的分类列会进入“换一个维度”的候选', () => {
    const auto = buildCheckup(uci)
    const mapping = base({ x: 'Month', metric: 'cnt', unit: '次' })
    expect(buildNextCuts(result(mapping), auto, 30).some(cut => cut.mapping.x === 'Administrative')).toBe(false)
    const corrected = buildCheckup(uci, { Administrative: 'category' })
    expect(buildNextCuts(result(mapping), corrected, 30).some(cut => cut.mapping.x === 'Administrative')).toBe(true)
  })
})
