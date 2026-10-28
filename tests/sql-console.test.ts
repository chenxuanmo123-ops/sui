import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic } from 'sql.js'
import { resolve } from 'node:path'
import type { Dataset } from '../src/data'
import { installSQL } from '../src/analytics'
import { dropExtraTable, installExtraTable, maskSql, runConsoleQuery, validateReadOnlyQuery } from '../src/sql-console'
import { numericCell, numericColumns, sqlChartDefaults, sqlChartSeries } from '../src/sql-chart'

let SQL: SqlJsStatic
beforeAll(async () => { SQL = await initSqlJs({ locateFile: f => resolve('node_modules/sql.js/dist', f) }) })

const dataset: Dataset = {
  title: '控制台测试', sourceUrl: '', loadedAt: '2026-10-23', fingerprint: 'console-sha256', isPublic: false,
  headers: ['组', '价格'],
  rows: [
    { 组: 'a', 价格: '10' }, { 组: 'a', 价格: '20' },
    { 组: 'b', 价格: '30' }, { 组: 'b', 价格: '' },
  ],
}
function engine() { const db = new SQL.Database(); installSQL(db, dataset); return db }
function use<T>(fn: (db: Database) => T): T { const db = engine(); try { return fn(db) } finally { db.close() } }

describe('只读 SQL 控制台', () => {
  it('拒绝写操作、多条语句、内部表和参数', () => {
    for (const sql of [
      'DELETE FROM data', 'UPDATE data SET c0 = 1', 'DROP TABLE data',
      'SELECT 1; SELECT 2', 'PRAGMA table_info(data)', 'WITH x AS (SELECT 1) DELETE FROM data',
      'SELECT * FROM sqlite_master', 'SELECT ?', 'SELECT * FROM data WHERE c0 = :name',
      'ATTACH DATABASE \'x\' AS y', 'load_extension(\'x\')',
    ]) expect(() => validateReadOnlyQuery(sql), sql).toThrow()
    expect(validateReadOnlyQuery('  SELECT * FROM data;  ')).toBe('SELECT * FROM data')
    expect(validateReadOnlyQuery('-- 注释\nSELECT 1')).toBe('-- 注释\nSELECT 1')
  })

  it('字符串和注释里的关键字、分号不触发拒绝', () => {
    expect(validateReadOnlyQuery("SELECT 'DELETE; DROP TABLE data' AS note")).toContain("'DELETE; DROP TABLE data'")
    expect(validateReadOnlyQuery('SELECT 1 /* ; DELETE FROM data */')).toBe('SELECT 1 /* ; DELETE FROM data */')
    expect(validateReadOnlyQuery('SELECT 1 AS "delete"')).toBe('SELECT 1 AS "delete"')
    expect(maskSql("SELECT 'a''b' -- ; DELETE\n, 2")).not.toContain('DELETE')
  })

  it('在 readable 视图与原表头上执行真实查询', () => {
    use(db => {
      const grouped = runConsoleQuery(db, 'SELECT "组", COUNT(*) AS n FROM readable GROUP BY "组" ORDER BY "组"')
      expect(grouped.columns).toEqual(['组', 'n'])
      expect(grouped.rows).toEqual([['a', 2], ['b', 2]])
      const numeric = runConsoleQuery(db, 'SELECT "组", AVG(strict_number("价格")) AS avg FROM readable WHERE strict_number("价格") IS NOT NULL GROUP BY "组" ORDER BY "组"')
      expect(numeric.rows).toEqual([['a', 15], ['b', 30]])
      const raw = runConsoleQuery(db, 'SELECT * FROM data LIMIT 1')
      expect(raw.columns).toEqual(['_record', 'c0', 'c1'])
      expect(raw.rows).toEqual([[2, 'a', '10']])
    })
  })

  it('会话内关联表以固定名称装载，可 JOIN 且可移除', () => {
    use(db => {
      const loaded = installExtraTable(db, {
        headers: ['组', '人数'],
        rows: [{ 组: 'a', 人数: '2' }, { 组: 'b', 人数: '3' }, { 组: 'c', 人数: '4' }],
      })
      expect(loaded).toEqual({ name: 'extra', columns: 2, rows: 3, names: ['组', '人数'] })
      const joined = runConsoleQuery(db, 'SELECT d."c0" AS g, e."c1" AS n FROM data AS d JOIN extra AS e ON d."c0" = e."c0" GROUP BY d."c0", e."c1" ORDER BY g')
      expect(joined.rows).toEqual([['a', '2'], ['b', '3']])
      expect(runConsoleQuery(db, 'SELECT * FROM extra_readable LIMIT 1').columns).toEqual(['_row', '组', '人数'])
      // Reloading replaces rows instead of appending them.
      installExtraTable(db, { headers: ['组'], rows: [{ 组: 'a' }] })
      expect(runConsoleQuery(db, 'SELECT COUNT(*) AS n FROM extra').rows).toEqual([[1]])
      dropExtraTable(db)
      expect(() => runConsoleQuery(db, 'SELECT * FROM extra')).toThrow()
      expect(() => db.run('DELETE FROM data')).toThrow()
    })
  })

  it('关联表拒绝空列名和超限列数', () => {
    use(db => {
      expect(() => installExtraTable(db, { headers: [''], rows: [{ '': '1' }] })).toThrow('空列名')
      expect(() => installExtraTable(db, { headers: Array.from({ length: 501 }, (_, i) => 'f' + i), rows: [] })).toThrow('500')
      // Duplicate headers cannot become view names; the fallback is cN.
      expect(installExtraTable(db, { headers: ['组', '组'], rows: [{ 组: '1' }] }).names).toEqual(['c0', 'c1'])
      expect(runConsoleQuery(db, 'SELECT "c1" FROM extra_readable').columns).toEqual(['c1'])
    })
  })

  it('结果图表只接受真实数值，并选择明确横纵轴', () => {
    const columns = ['country', 'n', 'total']
    const rows: (string | number | null)[][] = [['China', 8, '15738.01'], ['India', 8, '205.01']]
    expect(numericColumns(columns, rows)).toEqual([1, 2])
    // `n` is flat (8, 8); `total` carries the variation, so it becomes the
    // default measure instead of producing a meaningless flat chart.
    expect(sqlChartDefaults(columns, rows)).toEqual({ x: 0, y: 2, kind: 'bar' })
    expect(sqlChartSeries({ x: 0, y: 2, kind: 'bar' }, rows)).toEqual({ labels: ['China', 'India'], values: [15738.01, 205.01] })
    expect(sqlChartDefaults(['n'], [['3'], ['4']])).toEqual({ x: -1, y: 0, kind: 'bar' })
    expect(sqlChartDefaults(['name'], [['a']])).toEqual({ x: 0, y: -1, kind: 'bar' })
    expect(numericColumns(['v'], [['1'], [null], ['3']])).toEqual([0])
    expect(numericColumns(['v'], [['1'], ['$2']])).toEqual([])
    expect(numericCell('1,234')).toBe(null)
    expect(numericCell('1e3')).toBe(1000)
    expect(numericCell('')).toBe(null)
    expect(sqlChartSeries({ x: -1, y: 0, kind: 'line' }, [['5'], [null]])).toEqual({ labels: ['第 1 行', '第 2 行'], values: [5, null] })
  })

  it('行数上限明确截断，且底层连接仍是只读', () => {
    use(db => {
      const result = runConsoleQuery(db, 'SELECT * FROM data', 2)
      expect(result.rows).toHaveLength(2)
      expect(result.truncated).toBe(true)
      expect(runConsoleQuery(db, 'SELECT * FROM data', 10).truncated).toBe(false)
      expect(() => db.run('DELETE FROM data')).toThrow()
    })
  })
})
