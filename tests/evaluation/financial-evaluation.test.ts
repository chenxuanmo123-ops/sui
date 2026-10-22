import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic } from 'sql.js'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseCSV } from '../../src/data'
import type { Dataset } from '../../src/data'
import { installSQL, runAggregate } from '../../src/analytics'

const raw = readFileSync(resolve('tests/fixtures/evaluation/financial/apple-sec-company-facts-fy2021-2023.csv'), 'utf8')
const data: Dataset = {
  ...parseCSV(raw),
  title: 'SEC Apple Company Facts 固定 accession',
  sourceUrl: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json',
  loadedAt: '2026-10-17',
  fingerprint: 'sec-apple-fy2023-accession',
  isPublic: true,
}

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: file => resolve('node_modules/sql.js/dist', file) })
})

function use<T>(fn: (database: Database) => T): T {
  const database = new SQL.Database()
  installSQL(database, data)
  try {
    return fn(database)
  } finally {
    database.close()
  }
}

describe('SEC 官方财务事实评测集（固定 accession，不代表模型评测）', () => {
  it('来源快照哈希、行数与评测案例登记一致', () => {
    const provenance = JSON.parse(readFileSync(resolve('tests/fixtures/evaluation/financial/provenance.json'), 'utf8'))
    const cases = JSON.parse(readFileSync(resolve('tests/evaluation/cases.json'), 'utf8'))
    const sourceResponse = readFileSync(resolve('tests/fixtures/evaluation/financial/apple-sec-company-facts-response.json'))
    expect(createHash('sha256').update(raw, 'utf8').digest('hex')).toBe(provenance.fixtureSha256)
    expect(provenance.rows).toBe(data.rows.length)
    expect(createHash('sha256').update(sourceResponse).digest('hex')).toBe(provenance.sourceResponseSha256)
    expect(statSync(resolve('tests/fixtures/evaluation/financial/apple-sec-company-facts-response.json')).size).toBe(provenance.sourceResponseBytes)
    expect(provenance.sourceResponseFile).toBe('apple-sec-company-facts-response.json')
    expect(cases.cases.some((item: { id: string }) => item.id === 'sec-apple-annual-financial-facts')).toBe(true)
    const verification = JSON.parse(readFileSync(resolve('tests/fixtures/evaluation/financial/sec-2023-10k-revenue-verification.json'), 'utf8'))
    expect(verification.sourceUrl).toContain('aapl-20230930.htm')
    expect(verification.reportedMillionsUsd).toEqual({ FY2023: 383285, FY2022: 394328, FY2021: 365817 })
  })

  it('保留 13 条真实披露事实及来源 accession，期间流量按披露期正确分组', () => use(database => {
    expect(data.rows).toHaveLength(13)
    expect(data.rows.every(row => row.accession === '0000320193-23-000106' && row.form === '10-K')).toBe(true)
    const revenue = runAggregate(database, data, {
      x: 'period_label', metric: 'value', filter: 'metric', value: 'revenue',
      from: '', to: '', unit: 'USD', aggregate: 'sum', timeBucket: 'none',
    }, 'SEC 年度收入基准', 10)
    expect(revenue.points.map(point => [point.label, point.value])).toEqual([
      ['FY2021', 365817000000],
      ['FY2022', 394328000000],
      ['FY2023', 383285000000],
    ])
    expect(revenue.points.map(point => point.rowIds)).toEqual([[12], [13], [14]])
  }))

  it('明确区分期末存量与期间流量，不将 Filing FY 冒充 comparative period', () => {
    const stock = data.rows.filter(row => row.fact_type === 'stock' && row.metric === 'cash_and_cash_equivalents')
    expect(stock.map(row => [row.period_label, row.start, row.end, row.value])).toEqual([
      ['FY2022', null, '2022-09-24', '23646000000'],
      ['FY2023', null, '2023-09-30', '29965000000'],
    ])
    expect(data.rows.filter(row => row.fact_type === 'flow' && row.metric === 'revenue').map(row => [row.period_label, row.start, row.end])).toEqual([
      ['FY2021', '2020-09-27', '2021-09-25'],
      ['FY2022', '2021-09-26', '2022-09-24'],
      ['FY2023', '2022-09-25', '2023-09-30'],
    ])
    expect(data.rows.every(row => row.filing_fy === '2023' && row.accession === '0000320193-23-000106')).toBe(true)
  })
})
