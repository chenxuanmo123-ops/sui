import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic } from 'sql.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { formatNumber, parseCSV } from '../src/data'
import type { Analysis, Dataset, Mapping } from '../src/data'
import { installSQL, runAggregate, runExplore } from '../src/analytics'
import { buildCheckup, recognizeBinary } from '../src/checkup'
import { buildInsight } from '../src/insight'
let SQL: SqlJsStatic
const owid: Dataset = {
  ...parseCSV(readFileSync(resolve('tests/fixtures/owid-China-2015-2022.csv'), 'utf8')),
  title: 'OWID 真实中国年度子集', sourceUrl: 'https://github.com/owid/energy-data', loadedAt: '2026-10-15', fingerprint: 'checkup-owid', isPublic: false,
}
const uci: Dataset = {
  ...parseCSV(readFileSync(resolve('tests/fixtures/uci-online-shoppers.csv'), 'utf8')),
  title: 'UCI 在线购物会话', sourceUrl: 'https://archive.ics.uci.edu/dataset/468/online+shoppers+purchasing+intention+dataset', loadedAt: '2026-10-15', fingerprint: 'checkup-uci', isPublic: false,
}
beforeAll(async () => { SQL = await initSqlJs({ locateFile: f => resolve('node_modules/sql.js/dist', f) }) })
function use<T>(dataset: Dataset, fn: (db: Database) => T): T {
  const db = new SQL.Database()
  installSQL(db, dataset)
  try { return fn(db) } finally { db.close() }
}
function base(overrides: Partial<Mapping>): Mapping {
  return { x: '', metric: '', filter: '', value: '', from: '', to: '', unit: '', aggregate: 'sum', timeBucket: 'none', conditions: [], ...overrides }
}
function emptyResult(overrides: Partial<Analysis>): Analysis {
  return {
    id: 1, question: '空', mapping: base({ x: 'year', metric: 'value', unit: 'TWh' }), points: [],
    usedRows: 0, skipped: 0, matched: 0, createdAt: '2026-10-15T00:00:00.000Z', datasetHash: 'manual',
    finding: '没有生成有效结果', operations: [], ...overrides,
  }
}

describe('本地数据体检：角色与候选问题都来自真实取值', () => {
  it('识别真实年度字段、数值指标和单值维度，并给出可执行问题', () => {
    const checkup = buildCheckup(owid)
    expect(checkup.rows).toBe(8)
    expect(checkup.fields).toBe(5)
    expect(checkup.completeness).toBe(1)
    expect(checkup.missingCells).toBe(0)
    expect(checkup.duplicateRows).toBe(0)
    expect(checkup.timeField?.key).toBe('year')
    expect(checkup.timeField?.time).toMatchObject({ granularity: 'year', distinct: 8, gaps: 0, min: '2015', max: '2022' })
    expect(checkup.measures.map(field => field.key)).toEqual(['renewables_electricity', 'solar_electricity', 'wind_electricity'])
    expect(checkup.categories).toEqual([])
    expect(checkup.questions[0]).toMatchObject({ kind: 'trend', chart: 'line' })
    expect(checkup.questions[0].title).toContain('year')
    expect(checkup.questions.map(question => question.kind)).toContain('correlation')
    expect(checkup.summary).toContain('8 行、5 个字段')
    expect(checkup.summary).toContain('2015–2022')
    expect(checkup.warnings.some(warning => warning.title === '单位需要你确认')).toBe(true)
  })

  it('候选问题映射满足既有引擎约束，并能在真实 SQLite 上执行', () => {
    const checkup = buildCheckup(owid)
    const aggregateQuestions = checkup.questions.filter(question => question.execution.kind === 'aggregate')
    expect(aggregateQuestions.length).toBeGreaterThan(0)
    for (const question of aggregateQuestions) {
      const mapping = question.execution.kind === 'aggregate' ? question.execution.mapping : null
      expect(mapping).not.toBeNull()
      expect(owid.headers).toContain(mapping!.x)
      expect(owid.headers).toContain(mapping!.metric)
      if (mapping!.aggregate !== 'count') expect(mapping!.x).not.toBe(mapping!.metric)
      expect(mapping!.conditions).toEqual([])
      const result = use(owid, db => runAggregate(db, owid, mapping!, question.question, 1))
      expect(result.points.length).toBeGreaterThan(0)
      expect(result.points.every(point => Number.isFinite(point.value))).toBe(true)
      expect(result.points.flatMap(point => point.rowIds).length).toBeGreaterThan(0)
    }
    const exploreQuestions = checkup.questions.filter(question => question.execution.kind === 'explore')
    expect(exploreQuestions.length).toBeGreaterThan(0)
    for (const question of exploreQuestions) {
      const spec = question.execution.kind === 'explore' ? question.execution.spec : null
      expect(spec).not.toBeNull()
      const result = use(owid, db => runExplore(db, owid, spec!))
      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.rowIds.flat().length).toBeGreaterThan(0)
    }
  })

  it('识别二值结果并生成 count + % 的比例问题，真实计算排除未知值', () => {
    const checkup = buildCheckup(uci)
    const revenue = checkup.binaries.find(field => field.key === 'Revenue')
    expect(revenue?.binary).toMatchObject({ successValue: 'TRUE' })
    const rate = checkup.questions.find(question => question.kind === 'rate')
    expect(rate).toBeDefined()
    const mapping = rate!.execution.kind === 'aggregate' ? rate!.execution.mapping : null
    expect(mapping).toMatchObject({ aggregate: 'count', unit: '%' })
    const outcome = checkup.binaries.find(field => field.key === mapping!.metric)
    expect(outcome).toBeDefined()
    expect(mapping!.rate!.successValue).toBe(outcome!.binary!.successValue)
    expect([...mapping!.rate!.eligibleValues].sort()).toEqual([...outcome!.binary!.values].sort())
    expect(mapping!.x).not.toBe(mapping!.metric)
    const result = use(uci, db => runAggregate(db, uci, mapping!, rate!.question, 1))
    expect(result.rateSummary).toBeDefined()
    expect(result.rateSummary!.numerator).toBeGreaterThan(0)
    expect(result.rateSummary!.denominator).toBeGreaterThan(result.rateSummary!.numerator)
    expect(result.rateSummary!.denominator + result.rateSummary!.excluded).toBeLessThanOrEqual(uci.rows.length)
    expect(result.rateSummary!.value).toBeCloseTo(result.rateSummary!.numerator / result.rateSummary!.denominator * 100, 8)
    expect(result.points.every(point => point.rate && point.rate.denominator >= point.rate.numerator)).toBe(true)
    expect(result.usedRows).toBe(result.rateSummary!.denominator)
  })

  it('中性 0/1 标记不会被当作业务结果生成比例问题', () => {
    const dataset: Dataset = {
      ...owid, headers: ['组', '标记'], fingerprint: 'checkup-neutral-flag',
      rows: Array.from({ length: 30 }, (_, index) => ({ 组: index % 2 ? 'a' : 'b', 标记: String(index % 2) })),
    }
    const checkup = buildCheckup(dataset)
    expect(checkup.binaries.map(field => field.key)).toContain('标记')
    expect(checkup.questions.some(question => question.kind === 'rate')).toBe(false)
  })

  it('零膨胀指标不用中位数生成全零排名，排名结果保留组间差异', () => {
    const checkup = buildCheckup(uci)
    const rank = checkup.questions.find(question => question.kind === 'rank')
    expect(rank).toBeDefined()
    const mapping = rank!.execution.kind === 'aggregate' ? rank!.execution.mapping : null
    expect(mapping?.metric).toBe('PageValues')
    // PageValues has min=0 as its median; a median comparison would flatten
    // every group to 0 and look like a real but meaningless finding.
    expect(mapping!.aggregate).not.toBe('median')
    const result = use(uci, db => runAggregate(db, uci, mapping!, rank!.question, 1))
    expect(result.points.length).toBeGreaterThan(1)
    expect(result.points.every(point => point.value > 0)).toBe(true)
    expect(new Set(result.points.map(point => point.value)).size).toBeGreaterThan(1)
  })

  it('只有两种取值时识别正类原值，未知编码保持未识别', () => {
    expect(recognizeBinary(['是', '否'])).toMatchObject({ successValue: '是', positiveLabel: '是' })
    expect(recognizeBinary(['1', '0'])).toMatchObject({ successValue: '1', positiveLabel: '取值为 1' })
    expect(recognizeBinary(['TRUE', 'FALSE'])).toMatchObject({ successValue: 'TRUE' })
    expect(recognizeBinary(['高', '低'])).toBeNull()
    expect(recognizeBinary(['是', '否', '未知'])).toBeNull()
  })

  it('没有时间与数值指标时只提出可执行的记录数问题，并明确提示限制', () => {
    const dataset: Dataset = {
      ...owid, headers: ['渠道'], fingerprint: 'checkup-category-only', rows: [
        { 渠道: '搜索' }, { 渠道: '搜索' }, { 渠道: '直接' }, { 渠道: '直接' },
      ],
    }
    const checkup = buildCheckup(dataset)
    expect(checkup.timeField).toBeNull()
    expect(checkup.measures).toEqual([])
    expect(checkup.warnings.some(warning => warning.title === '没有可验证的时间字段')).toBe(true)
    expect(checkup.warnings.some(warning => warning.title === '没有稳定的数值指标')).toBe(true)
    expect(checkup.questions[0]).toMatchObject({ kind: 'count', chart: 'bar' })
    const mapping = checkup.questions[0].execution.kind === 'aggregate' ? checkup.questions[0].execution.mapping : null
    expect(mapping).toMatchObject({ aggregate: 'count', x: '渠道', metric: '渠道' })
    const result = use(dataset, db => runAggregate(db, dataset, mapping!, checkup.questions[0].question, 1))
    expect(result.points.map(point => point.value)).toEqual([2, 2])
  })

  it('按日数据跨度不超过三年时按月建议，计数指标按求和', () => {
    const rows: Dataset['rows'] = []
    for (let year = 2023; year <= 2024; year++) {
      for (let month = 1; month <= 12; month++) {
        rows.push({ 日期: `${year}-${String(month).padStart(2, '0')}-01`, 次数: String(month * 10) })
      }
    }
    const dataset: Dataset = { ...owid, headers: ['日期', '次数'], rows, fingerprint: 'checkup-daily' }
    const checkup = buildCheckup(dataset)
    expect(checkup.timeField?.time).toMatchObject({ granularity: 'date', distinct: 24, min: '2023-01-01', max: '2024-12-01' })
    const trend = checkup.questions.find(question => question.kind === 'trend')
    expect(trend).toBeDefined()
    const mapping = trend!.execution.kind === 'aggregate' ? trend!.execution.mapping : null
    expect(mapping).toMatchObject({ x: '日期', metric: '次数', timeBucket: 'month', aggregate: 'sum' })
    const result = use(dataset, db => runAggregate(db, dataset, mapping!, trend!.question, 1))
    expect(result.points).toHaveLength(24)
    expect(result.trend).toBeDefined()
    const brief = buildInsight(result)
    expect(brief.sections.find(section => section.key === 'meaning')!.body).toContain('季节调整')
    expect(brief.sections.find(section => section.key === 'need')!.body).toContain('年内周期')
  })

  it('四位数计数不会被误判成年份，低基数整数编码作为分类维度', () => {
    const rows: Dataset['rows'] = Array.from({ length: 30 }, (_, index) => ({
      日期: `2024-01-${String(index + 1).padStart(2, '0')}`,
      骑行次数: String(1200 + index * 37),
      季节: String((index % 4) + 1),
    }))
    const dataset: Dataset = { ...owid, headers: ['日期', '骑行次数', '季节'], rows, fingerprint: 'checkup-year-like-count' }
    const checkup = buildCheckup(dataset)
    expect(checkup.timeField?.key).toBe('日期')
    expect(checkup.measures.map(field => field.key)).toEqual(['骑行次数'])
    expect(checkup.categories.map(field => field.key)).toContain('季节')
    const trend = checkup.questions.find(question => question.kind === 'trend')!
    const mapping = trend.execution.kind === 'aggregate' ? trend.execution.mapping : null
    expect(mapping).toMatchObject({ metric: '骑行次数', timeBucket: 'month', aggregate: 'sum' })
  })

  it('顺序行号不会被当作指标，也不会进入相关性候选', () => {
    const dataset: Dataset = {
      ...owid, headers: ['instant', '温度', '销量'], fingerprint: 'checkup-instant',
      rows: Array.from({ length: 25 }, (_, index) => ({
        instant: String(index + 1), 温度: String(10 + index), 销量: String((index * 7) % 23),
      })),
    }
    const checkup = buildCheckup(dataset)
    expect(checkup.identifiers.map(field => field.key)).toEqual(['instant'])
    expect(checkup.measures.map(field => field.key)).toEqual(['温度', '销量'])
    const correlation = checkup.questions.find(question => question.kind === 'correlation')
    expect(correlation).toBeDefined()
    expect(correlation!.title).not.toContain('instant')
  })

  it('编号列不会被当作可求和指标，并给出重复与空值提示', () => {
    const dataset: Dataset = {
      ...owid, headers: ['订单号', '金额'], fingerprint: 'checkup-identifier', rows: Array.from({ length: 25 }, (_, index) => ({
        订单号: `ORD-${String(index + 1).padStart(4, '0')}`, 金额: index === 1 ? null : String(index * 10),
      })),
    }
    const checkup = buildCheckup(dataset)
    expect(checkup.identifiers.map(field => field.key)).toEqual(['订单号'])
    expect(checkup.measures.map(field => field.key)).toEqual(['金额'])
    expect(checkup.warnings.some(warning => warning.title === '可能有编号字段')).toBe(true)
    expect(checkup.warnings.some(warning => warning.title === '存在空值')).toBe(true)
    expect(checkup.completeness).toBeCloseTo(49 / 50, 8)
  })
})

describe('确定性结果解读：只陈述计算结果与边界', () => {
  it('趋势结果先给观察，再给候选含义、用途、所需信息与不能得出的结论', () => {
    const checkup = buildCheckup(owid)
    const question = checkup.questions.find(item => item.kind === 'trend')!
    const mapping = question.execution.kind === 'aggregate' ? question.execution.mapping : null
    const result = use(owid, db => runAggregate(db, owid, mapping!, question.question, 1))
    const brief = buildInsight(result)
    expect(brief.sections.map(section => section.key)).toEqual(['observed', 'meaning', 'use', 'need', 'limit'])
    expect(brief.headline).toContain('renewables_electricity')
    expect(brief.headline).toContain('R²')
    expect(brief.sections.find(section => section.key === 'observed')!.body).toContain(formatNumber(result.usedRows, 0))
    expect(brief.sections.find(section => section.key === 'meaning')!.body).toContain('单凭这张表无法区分')
    expect(brief.sections.find(section => section.key === 'limit')!.body).toContain('不能得出')
    expect(brief.sections.find(section => section.key === 'need')!.body).toContain('指标单位和数量级')
    expect(brief.tone).not.toBe('flat')
  })

  it('比例结果引用总分子、总分母和排除数，不把分组比例平均成总体比例', () => {
    const checkup = buildCheckup(uci)
    const question = checkup.questions.find(item => item.kind === 'rate')!
    const mapping = question.execution.kind === 'aggregate' ? question.execution.mapping : null
    const result = use(uci, db => runAggregate(db, uci, mapping!, question.question, 1))
    const brief = buildInsight(result)
    const observed = brief.sections.find(section => section.key === 'observed')!.body
    expect(brief.headline).toContain('总体比例为')
    expect(observed).toContain(formatNumber(result.rateSummary!.numerator, 0))
    expect(observed).toContain(formatNumber(result.rateSummary!.denominator, 0))
    expect(observed).toContain('未知或缺失结果')
    expect(observed).toContain('记录占比')
    expect(observed).toContain(mapping!.rate!.successValue)
    expect(brief.sections.find(section => section.key === 'meaning')!.body).toContain('不能把差异归因于某一项措施')
  })

  it('记录数结果按行计数表述，不把行数写成指标列的总量', () => {
    const result = use(uci, db => runAggregate(db, uci, base({ x: 'VisitorType', metric: 'Revenue', aggregate: 'count', unit: '次访问' }), '记录数', 1))
    const brief = buildInsight(result)
    expect(brief.headline).toContain('记录数')
    expect(brief.headline).not.toContain('Revenue')
    expect(brief.sections.find(section => section.key === 'observed')!.body).toContain('统计记录数')
    expect(brief.sections.find(section => section.key === 'meaning')!.body).toContain('组间记录数不同')
    expect(brief.sections.find(section => section.key === 'use')!.body).toContain('不能把记录数当作业务规模或用户数')
  })

  it('单一分组时不声称趋势或组间差异', () => {
    const dataset: Dataset = { ...owid, headers: ['组', '值'], fingerprint: 'checkup-single', rows: [{ 组: 'a', 值: '1' }, { 组: 'a', 值: '3' }] }
    const result = use(dataset, db => runAggregate(db, dataset, base({ x: '组', metric: '值', aggregate: 'sum' }), '单组', 1))
    const brief = buildInsight(result)
    expect(brief.tone).toBe('flat')
    expect(brief.headline).toContain('只有一个分组')
    expect(brief.headline).toContain('无法比较组间差异或判断趋势')
  })

  it('各组结果相同时不虚报最高最低，而是说明当前口径无法区分', () => {
    const dataset: Dataset = {
      ...owid, headers: ['组', '值'], fingerprint: 'checkup-uniform', rows: [
        { 组: 'a', 值: '0' }, { 组: 'a', 值: '0' }, { 组: 'a', 值: '100' },
        { 组: 'b', 值: '0' }, { 组: 'b', 值: '0' }, { 组: 'b', 值: '100' },
        { 组: 'c', 值: '0' }, { 组: 'c', 值: '0' }, { 组: 'c', 值: '100' },
      ],
    }
    const result = use(dataset, db => runAggregate(db, dataset, base({ x: '组', metric: '值', aggregate: 'median' }), '组间中位数', 1))
    expect(new Set(result.points.map(point => point.value)).size).toBe(1)
    const brief = buildInsight(result)
    expect(brief.tone).toBe('flat')
    expect(brief.headline).toContain('都为')
    expect(brief.headline).toContain('没有可区分的组间差异')
    expect(brief.headline).not.toContain('最高')
    expect(brief.sections.find(section => section.key === 'meaning')!.body).toContain('聚合方式把差异压平')
    expect(brief.sections.find(section => section.key === 'use')!.body).toContain('不能据此判断各组业务表现相同')
  })

  it('没有有效分组时只说明无法推断，不补造解释', () => {
    // The engine refuses to return an empty Analysis; this covers the UI's
    // defensive branch when a stored result carries no points.
    const brief = buildInsight(emptyResult({ finding: '没有符合口径的记录' }))
    expect(brief.headline).toContain('没有可计算的分组')
    expect(brief.sections.map(section => section.key)).toEqual(['observed', 'limit'])
    expect(brief.sections.find(section => section.key === 'limit')!.body).toContain('不能推断趋势、差异或业务含义')
  })
})
