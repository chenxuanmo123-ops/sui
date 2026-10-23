import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parseCSV, numberValue } from '../src/data'
import type { Dataset } from '../src/data'
import { inspectQuality, numericDistribution, qualityRecords } from '../src/preparation'

const raw = readFileSync('tests/fixtures/uci-online-shoppers.csv', 'utf8')
const expected = JSON.parse(readFileSync('tests/fixtures/uci-online-shoppers-expected.json', 'utf8'))
const dataset: Dataset = { ...parseCSV(raw), title: 'UCI Online Shoppers', sourceUrl: 'https://archive.ics.uci.edu/dataset/468/online+shoppers+purchasing+intention+dataset', fingerprint: createHash('sha256').update(raw).digest('hex'), loadedAt: '2026-10-23', isPublic: true }
const quality = inspectQuality(dataset)
describe('无需 AI 的质量诊断（真实 UCI 数据）', () => {
 it('来源快照校验和、记录数正确', () => { expect(dataset.fingerprint).toBe(expected.sha256); expect(dataset.rows).toHaveLength(12330) })
 it('分箱频数覆盖所有严格数值，独立按区间反算一致', () => {
  const distribution = numericDistribution(dataset, 'ProductRelated_Duration')
  expect(distribution.numeric).toBe(12330); expect(distribution.excluded).toBe(0)
  expect(distribution.bins.reduce((n, bin) => n + bin.count, 0)).toBe(12330)
  for (const bin of distribution.bins) expect(bin.count).toBe(dataset.rows.filter(row => { const n = numberValue(row.ProductRelated_Duration); return n >= bin.lower && (bin.inclusiveUpper ? n <= bin.upper : n < bin.upper) }).length)
 })
 it('非数值文本保留，不冒充缺失或数值分布', () => {
  const field = quality.fields.find(field => field.field === 'VisitorType')!
  expect(numericDistribution(dataset, field.field).bins).toEqual([])
  expect(qualityRecords(dataset, field.field, 'nonnumeric', field).total).toBe(12330)
  expect(qualityRecords(dataset, field.field, 'missing', field).total).toBe(0)
 })
 it('异常候选定位与画像一致，分页不重不漏，保留原记录号', () => {
  const field = quality.fields.find(field => field.field === 'ProductRelated_Duration')!
  const first = qualityRecords(dataset, field.field, 'outlier', field)
  const second = qualityRecords(dataset, field.field, 'outlier', field, 1)
  expect(first.total).toBe(field.outliers); expect(first.total).toBeGreaterThan(25)
  expect(first.records).toHaveLength(25); expect(second.records).toHaveLength(25)
  expect(new Set([...first.records, ...second.records].map(row => row.index)).size).toBe(50)
  for (const record of first.records) { expect(record.sourceRecord).toBe(record.index + 2); expect(record.value).toBe(dataset.rows[record.index][field.field]) }
 })
 it('整行重复候选与全量画像一致，不把第一条当成待删除记录', () => {
  const field = quality.fields[0], result = qualityRecords(dataset, field.field, 'duplicate', field)
  expect(result.total).toBe(quality.duplicateRows)
  for (const record of result.records) expect(dataset.rows.slice(0, record.index).some(row => dataset.headers.every(header => row[header] === dataset.rows[record.index][header]))).toBe(true)
 })
})
describe('算法极值与来源定位边界（明确的单元测试值，非产品数据）', () => {
 const data = (values: (string | null)[]): Dataset => ({ ...dataset, headers: ['value'], rows: values.map(value => ({ value })), sourceRecords: values.map((_, i) => 100 + i) })
 it('同值只生成一个区间，不把空值算作零', () => { const result = numericDistribution(data(['0', '0', null, '']), 'value'); expect(result.bins).toEqual([{ lower: 0, upper: 0, count: 2, inclusiveUpper: true }]); expect(result.excluded).toBe(2) })
 it('正负有限极值不产生无限分箱边界，区间中点归右箱', () => { const result = numericDistribution(data(['-1e308', '0', '1e308']), 'value', 2); expect(result.bins.map(bin => bin.count)).toEqual([1, 2]); expect(result.bins.every(bin => Number.isFinite(bin.lower) && Number.isFinite(bin.upper))).toBe(true) })
 it('问题记录保留清洗前来源编号，纯空白只归入缺失', () => { const d = data([' x ', ' ', null]); const summary = inspectQuality(d).fields[0]; const whitespace = qualityRecords(d, 'value', 'whitespace', summary); const missing = qualityRecords(d, 'value', 'missing', summary); expect(whitespace.records.map(row => row.sourceRecord)).toEqual([100]); expect(missing.records.map(row => row.sourceRecord)).toEqual([101, 102]); expect(whitespace.total).toBe(summary.whitespace); expect(missing.total).toBe(summary.missing); expect(d.rows[0].value).toBe(' x ') })
 it('未知字段和无效分页拒绝', () => { const d = data(['1']); const summary = inspectQuality(d).fields[0]; expect(() => numericDistribution(d, 'unknown')).toThrow(); expect(() => qualityRecords(d, 'value', 'missing', summary, -1)).toThrow(); expect(() => numericDistribution(d, 'value', 0)).toThrow() })
})
