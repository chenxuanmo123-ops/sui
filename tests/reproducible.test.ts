import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic } from 'sql.js'
import { resolve } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { parseCSV, numberValue, compareLabels, bucketLabel } from '../src/data'
import type { Dataset, Mapping } from '../src/data'
import { installSQL, runAggregate, runExplore } from '../src/analytics'
import type { ExploreSpec } from '../src/analytics'
import { buildBundle, exportColumnNames, inlineSql, recordColumnName, workspaceReproResult } from '../src/reproducible'

let SQL: SqlJsStatic
beforeAll(async () => { SQL = await initSqlJs({ locateFile: f => resolve('node_modules/sql.js/dist', f) }) })

const dataset: Dataset = {
  title: '复现包测试数据集',
  sourceUrl: '',
  loadedAt: '2026-10-23',
  fingerprint: 'bundle-fixture-sha256',
  isPublic: false,
  originalFileName: 'fixture.csv',
  originalFileHash: 'original-file-sha256',
  headers: ['组', '层', '值', 'why?'],
  rows: [
    { 组: 'a', 层: 'x', 值: '1', 'why?': 'O\'Brien, "quote"' },
    { 组: 'a', 层: 'x', 值: '2', 'why?': 'O\'Brien, "quote"' },
    { 组: 'a', 层: 'x', 值: '3', 'why?': 'O\'Brien, "quote"' },
    { 组: 'a', 层: 'y', 值: '10000', 'why?': 'O\'Brien, "quote"' },
    { 组: 'a', 层: 'y', 值: '20000', 'why?': 'O\'Brien, "quote"' },
    { 组: 'b', 层: 'x', 值: '5', 'why?': 'O\'Brien, "quote"' },
  ],
  sourceRecords: [2, 3, 4, 5, 6, 7],
}
const spec: ExploreSpec = { kind: 'heatmap', x: '组', y: '层', metric: '值', aggregate: 'median', filter: 'why?', value: 'O\'Brien, "quote"', bucket: 'none', sort: 'label', limit: 100 }

function functions(db: Database) {
  db.create_function('strict_number', value => { const n = numberValue(value === null ? null : String(value)); return Number.isFinite(n) ? n : null })
  db.create_function('compare_labels', (a, b) => compareLabels(String(a), String(b)))
  db.create_function('time_bucket', (value, bucket) => bucketLabel(String(value), String(bucket) as 'none'))
}
function bare() { const db = new SQL.Database(); functions(db); return db }
function engine() { const db = bare(); installSQL(db, dataset); return db }
function use<T>(fn: (db: Database) => T, db: Database = engine()): T { try { return fn(db) } finally { db.close() } }

describe('可复现 SQL 包（真实 SQLite 复跑）', () => {
  it('生成 CSV、schema、analysis、expected 与复跑脚本，且文件可解压', () => use(db => {
    const result = runExplore(db, dataset, spec)
    const bundle = buildBundle(dataset, {
      kind: 'exploration', title: '热力图 · 值', sql: result.sql, parameters: result.parameters as (string | number | null)[],
      columns: result.columns, rows: result.rows, rowIds: result.rowIds, total: result.total, excluded: result.excluded, truncated: result.truncated, spec: result.spec,
    })
    expect(bundle.name).toContain('数鉴-可复现SQL包')
    expect(Object.keys(bundle.files).sort()).toEqual(['README.md', 'analysis.sql', 'data.csv', 'expected.json', 'run_analysis.py', 'schema.sql'])
    const unzipped = Object.fromEntries(Object.entries(unzipSync(bundle.zip)).map(([name, data]) => [name, strFromU8(data)]))
    expect(unzipped).toEqual(bundle.files)
    expect(bundle.files['README.md']).toContain('python run_analysis.py')
    expect(bundle.files['run_analysis.py']).toContain('def strict_number')
    expect(bundle.files['data.csv'].split('\r\n')[0]).toBe('__record__,组,层,值,why?')
    expect(bundle.files['data.csv']).toContain('"O\'Brien, ""quote"""')
    expect(bundle.files['schema.sql']).toContain('CREATE VIEW data AS SELECT')
    expect(bundle.files['analysis.sql']).toContain("'O''Brien, \"quote\"'")
    expect(bundle.files['analysis.sql'].split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')).not.toContain('?')
    const expected = JSON.parse(bundle.files['expected.json'])
    expect(expected.dataset.fingerprint).toBe(dataset.fingerprint)
    expect(expected.result.rows).toEqual(result.rows)
    expect(expected.result.rowIds).toEqual(result.rowIds)
    expect(expected.dataset.sourceRecords).toEqual(dataset.sourceRecords)
  }))

  it('包内 schema + analysis 能在独立 SQLite 中复算出相同结果', () => {
    const built = use(db => {
      const result = runExplore(db, dataset, spec)
      return { result, bundle: buildBundle(dataset, {
        kind: 'exploration', title: '热力图 · 值', sql: result.sql, parameters: result.parameters as (string | number | null)[],
        columns: result.columns, rows: result.rows, rowIds: result.rowIds, total: result.total, excluded: result.excluded, truncated: result.truncated, spec: result.spec,
      }) }
    })
    const parsed = parseCSV(built.bundle.files['data.csv'])
    expect(parsed.headers).toEqual(['__record__', '组', '层', '值', 'why?'])
    use(db => {
      db.exec(built.bundle.files['schema.sql'])
      const insert = db.prepare('INSERT INTO listings VALUES (?, ?, ?, ?, ?)')
      try { parsed.rows.forEach(row => insert.run(['__record__', ...parsed.headers.slice(1)].map(key => row[key]))) } finally { insert.free() }
      const output = db.exec(built.bundle.files['analysis.sql'])[0]
      expect(output.values.map(row => row.slice(0, 3))).toEqual(built.result.rows)
      expect(output.values.map(row => row.slice(0, 3))).toEqual([['a', 'x', 2], ['a', 'y', 15000], ['b', 'x', 5]])
      expect(output.values.map(row => row[3])).toEqual(['2,3,4', '5,6', '7'])
    }, bare())
  })

  it('参数内联跳过注释中的问号，并转义引号', () => {
    const sql = '-- c0 = "why?"\nSELECT \'?\' AS literal, ? AS value'
    expect(inlineSql(sql, ["O'Brien"])).toBe('-- c0 = "why?"\nSELECT \'?\' AS literal, \'O\'\'Brien\' AS value')
    expect(() => inlineSql('SELECT ?', [])).toThrow('参数数量')
    expect(() => inlineSql('SELECT 1', [1])).toThrow('参数数量')
  })

  it('比例分析包含零分母分组，复跑行数与来源记录一致', () => {
    const rateData: Dataset = {
      title: '比例复现测试', sourceUrl: '', loadedAt: '2026-10-23', fingerprint: 'rate-sha256', isPublic: false,
      originalFileName: 'rate.csv', headers: ['组', '状态'],
      rows: [
        { 组: 'a', 状态: '成功' }, { 组: 'a', 状态: '失败' }, { 组: 'a', 状态: '失败' }, { 组: 'a', 状态: '未知' },
        { 组: 'b', 状态: '成功' }, { 组: 'b', 状态: '未知' }, { 组: 'c', 状态: '未知' },
      ],
      sourceRecords: [2, 3, 4, 5, 6, 7, 8],
    }
    const mapping: Mapping = { x: '组', metric: '状态', filter: '', value: '', from: '', to: '', unit: '%', aggregate: 'count', rate: { successValue: '成功', eligibleValues: ['成功', '失败'] } }
    const analysis = use(db => runAggregate(db, rateData, mapping, '比例', 1), (() => { const db = bare(); installSQL(db, rateData); return db })())
    expect(analysis.points.map(p => p.label)).toEqual(['a', 'b'])
    expect(analysis.points[0].value).toBeCloseTo(100 / 3, 9)
    expect(analysis.points[1].value).toBe(100)
    expect(analysis.unavailableGroups?.map(g => g.label)).toEqual(['c'])
    const result = workspaceReproResult(analysis)
    expect(result.columns).toEqual(['分组', '分子', '分母', '排除', '结果'])
    expect(result.rows.map(r => r.slice(0, 4))).toEqual([['a', 1, 3, 1], ['b', 1, 1, 1], ['c', 0, 0, 1]])
    expect(result.rows[0][4]).toBeCloseTo(100 / 3, 9)
    expect(result.rows[1][4]).toBe(100)
    expect(result.rows[2][4]).toBeNull()
    expect(result.rowIds).toEqual([[2, 3, 4], [6], []])
    expect(result.unavailable).toEqual([{ label: 'c', excluded: 1, rowIds: [8] }])
    const bundle = buildBundle(rateData, {
      kind: 'workspace', title: '比例', spec: mapping, sql: analysis.sql!, parameters: analysis.parameters ?? [],
      ...result,
    })
    const expected = JSON.parse(bundle.files['expected.json'])
    expect(expected.result.unavailable).toEqual([{ label: 'c', excluded: 1, rowIds: [8] }])
    const parsed = parseCSV(bundle.files['data.csv'])
    use(db => {
      db.exec(bundle.files['schema.sql'])
      const insert = db.prepare('INSERT INTO listings VALUES (?, ?, ?)')
      try { parsed.rows.forEach(row => insert.run(['__record__', '组', '状态'].map(key => row[key]))) } finally { insert.free() }
      const output = db.exec(bundle.files['analysis.sql'])[0]
      expect(output.values.map(row => row.slice(0, 4))).toEqual(result.rows.map(row => row.slice(0, 4)))
      expect(output.values[0][4]).toBeCloseTo(Number(result.rows[0][4]), 9)
      expect(output.values[1][4]).toBe(100)
      expect(output.values[2][4]).toBeNull()
      expect(output.values.map(row => row[5])).toEqual(['2,3,4', '6', null])
    }, bare())
  })

  it('大小写重名列回退到 cN，记录列避开同名表头', () => {
    const weird: Dataset = { ...dataset, headers: ['ID', 'id', '__RECORD__'], rows: [{ ID: '1', id: '2', __RECORD__: '3' }] }
    const record = recordColumnName(weird)
    expect(record).toBe('__record___')
    expect(exportColumnNames(weird, record)).toEqual(['c0', 'c1', 'c2'])
    const normal = exportColumnNames({ ...weird, headers: ['ID', '值'] }, '__record__')
    expect(normal).toEqual(['ID', '值'])
  })
})
