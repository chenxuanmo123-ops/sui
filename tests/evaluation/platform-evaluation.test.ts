import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic } from 'sql.js'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseCSV } from '../../src/data'
import type { Dataset } from '../../src/data'
import { installSQL, runAggregate } from '../../src/analytics'

const raw = readFileSync(resolve('tests/fixtures/evaluation/platform/stackoverflow-data-analysis-2024-01.csv'), 'utf8')
const data: Dataset = {
  ...parseCSV(raw),
  title: 'Stack Overflow 真实 data-analysis 标签问题事件',
  sourceUrl: 'https://api.stackexchange.com/2.3/questions',
  loadedAt: '2026-10-17',
  fingerprint: 'stackoverflow-data-analysis-2024-01',
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

describe('Stack Overflow 平台事件评测集（固定查询，不代表用户偏好）', () => {
  it('筛选字段来源快照、规范化 CSV 和来源登记哈希一致', () => {
    const provenance = JSON.parse(readFileSync(resolve('tests/fixtures/evaluation/platform/provenance.json'), 'utf8'))
    const response = readFileSync(resolve('tests/fixtures/evaluation/platform/stackoverflow-api-selected-snapshot.json'))
    expect(createHash('sha256').update(raw, 'utf8').digest('hex')).toBe(provenance.fixtureSha256)
    expect(createHash('sha256').update(response).digest('hex')).toBe(provenance.sourceSnapshotSha256)
    expect(statSync(resolve('tests/fixtures/evaluation/platform/stackoverflow-api-selected-snapshot.json')).size).toBe(provenance.sourceSnapshotBytes)
    expect(response.toString('utf8')).not.toContain('owner')
    expect(provenance.rows).toBe(61)
    expect(provenance.sourceSnapshotDescription).toContain('not the complete API response')
    expect(provenance.retrievedOn).toMatch(/^2026-10-17$/)
  })

  it('保留固定问题 ID 集、事件日期和标签，逐日计数来自真实 SQL', () => use(database => {
    const orderedIds = data.rows.map(row => row.question_id).join(',')
    expect(createHash('sha256').update(orderedIds, 'utf8').digest('hex')).toBe('457afc79b38d000e8f422da8c41ebd6ca8032b2964881d099d8c37f716b021d2')
    expect(data.rows).toHaveLength(61)
    expect(data.rows.every(row => row.event_date >= '2024-01-01' && row.event_date <= '2024-01-31')).toBe(true)
    expect(data.rows.every(row => row.tags.includes('data-analysis'))).toBe(true)
    const counts = runAggregate(database, data, {
      x: 'event_date', metric: 'question_id', filter: '', value: '',
      from: '2024-01-01', to: '2024-01-31', unit: '', aggregate: 'count', timeBucket: 'none',
    }, '平台事件日计数', 10)
    expect(counts.points.map(point => [point.label, point.value])).toEqual([
      ['2024-01-01', 1], ['2024-01-02', 1], ['2024-01-03', 1], ['2024-01-05', 3],
      ['2024-01-06', 2], ['2024-01-07', 1], ['2024-01-08', 3], ['2024-01-09', 5],
      ['2024-01-10', 3], ['2024-01-11', 1], ['2024-01-12', 3], ['2024-01-15', 3],
      ['2024-01-16', 3], ['2024-01-17', 4], ['2024-01-18', 1], ['2024-01-20', 2],
      ['2024-01-21', 1], ['2024-01-22', 3], ['2024-01-23', 3], ['2024-01-24', 3],
      ['2024-01-25', 5], ['2024-01-26', 1], ['2024-01-27', 1], ['2024-01-28', 1],
      ['2024-01-29', 1], ['2024-01-30', 3], ['2024-01-31', 2],
    ])
  }))

  it('数据边界明确：事件记录不能推出平台用户总量或偏好', () => {
    const cases = JSON.parse(readFileSync(resolve('tests/evaluation/cases.json'), 'utf8'))
    const item = cases.cases.find((candidate: { id: string }) => candidate.id === 'stackoverflow-question-events')
    expect(item.negative_claims).toEqual(expect.arrayContaining([
      'the 61 questions represent all Stack Overflow users',
      'data-analysis tag counts measure platform-wide user preference',
    ]))
  })
})
